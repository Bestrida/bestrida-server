var mongoose = require('../db');
var Users = require('./users');
var Segments = require('./segments');
var util = require('../util');

var challengeSchema = new mongoose.Schema({
  segmentId: { type: Number, required: true },
  segmentName: { type: String, required: true },
  segmentDistance: Number,
  segmentActivityType: String,
  segmentAverageGrade: Number,
  segmentElevationGain: Number,
  segmentClimbCategory: Number,
  segmentCity: String,
  segmentState: String,
  segmentCountry: String,
  challengerId: { type: Number, required: true },
  challengeeId: { type: Number, required: true },
  challengerName: String,
  challengeeName: String,
  challengerPhoto: String,
  challengeePhoto: String,
  challengerTime: Number,
  challengeeTime: Number,
  challengerCompleted: { type: Boolean, default: false },
  challengeeCompleted: { type: Boolean, default: false },
  challengerAvgCadence: Number,
  challengeeAvgCadence: Number,
  challengerAvgWatts: Number,
  challengeeAvgWatts: Number,
  challengerAvgHeartrate: Number,
  challengeeAvgHeartrate: Number,
  challengerMaxHeartRate: Number,
  challengeeMaxHeartRate: Number,
  status: { type: String, default: 'pending' },
  created: Date,
  expires: Date,
  completed: Date,
  expired: { type: Boolean, default: false },
  winnerId: Number,
  winnerName: String,
  loserId: Number,
  loserName: String
}, { timestamps: {} });

var Challenge = mongoose.model('Challenge', challengeSchema);

module.exports = Challenge;

module.exports.create = function (challenge, callback) {
  var createdDate = new Date();
  createdDate.setUTCHours(0, 0, 0, 0);
  var expiresDate = new Date(challenge.completionDate);
  expiresDate.setUTCHours(23, 59, 59, 999);

  var newChallenge = new Challenge({
    segmentId: challenge.segmentId,
    segmentName: challenge.segmentName,
    challengerId: challenge.challengerId,
    challengerName: challenge.challengerName,
    challengerPhoto: challenge.challengerPhoto,
    challengeeId: challenge.challengeeId,
    challengeeName: challenge.challengeeName,
    challengeePhoto: challenge.challengeePhoto,
    created: createdDate.toISOString(),
    expires: expiresDate.toISOString()
  });
  newChallenge.save(function (err, res) {
    if (err) {
      callback(err);
    } else {
      saveSegmentToChallenge(res.id, challenge.segmentId);
      callback(null, res);
    }
  });
};

module.exports.accept = function (challenge, callback) {
  Challenge.update({ _id: challenge.id }, { status: 'active' }, function (err, res) {
    if (err) {
      callback(err);
    } else {
      callback(null, res);
    }
  });
};

module.exports.decline = function (challenge, callback) {
  Challenge.find({ _id: challenge.id })
  .remove(function(err, res) {
    if (err) {
      callback(err);
    } else {
      callback(null, res);
    }
  });
};

module.exports.cronComplete = function() {
  var cutoff = new Date();
  var buffer = 0.5; // Buffer, in number of days
  cutoff.setTime(cutoff.getTime() - buffer * 86400000);
  Challenge.find({ expired: false, expires: { $lt: cutoff }, status: {$ne: 'complete'} })
  .then(function(result){
    console.log(result.length, 'expired challenges were found');

    result.forEach(function(aChallenge) {
      var onlyOneUserCompletedChallenge = (aChallenge.challengeeCompleted && !aChallenge.challengerCompleted) ||
                                          (!aChallenge.challengeeCompleted && aChallenge.challengerCompleted);

      // If neither completed challenge, delete challenge
      if (!aChallenge.challengeeCompleted && !aChallenge.challengerCompleted) {
        Challenge.find({ _id: aChallenge.id })
        .remove(function(err, raw) {
          if (err) console.log(err);
          console.log('removed challenges: ', !!raw.nModified);
        });

      // Else if only one user completed challenge, set default winner
      } else if (onlyOneUserCompletedChallenge) {
        updateChallengeResult(aChallenge);
      }
    });
  });
};

module.exports.complete = function (challenge, effort, callback) {
  if (!challenge) {
    callback('Challenge not sent to complete challenge model');
    return;
  }

  if (!effort) {
    callback('Effort not sent to complete challenge model');
    return;
  }

  // Can refactor code to pass the challenger/challengee role of user when
  // API is called to save us this extra request to the database
  Challenge.find({ _id: challenge.id })
  .then(function () {
    var userRole = challenge.challengerId === effort.athlete.id ? 'challenger' : 'challengee';
    if (userRole === 'challenger') {
      Challenge.update({ _id: challenge.id },
        {
          challengerTime: effort.elapsed_time,
          challengerCompleted: true,
          challengerAvgCadence: effort.average_cadence || 0,
          challengerAvgWatts: effort.average_watts || 0,
          challengerAvgHeartrate: effort.average_heartrate || 0,
          challengerMaxHeartRate: effort.max_heartrate || 0,
          segmentDistance: effort.segment.distance,
          segmentAverageGrade: effort.segment.average_grade,
          segmentMaxGrade: effort.segment.maximum_grade,
          segmentElevationHigh: effort.segment.elevation_high,
          segmentElevationLow: effort.segment.elevation_low,
          segmentClimbCategory: effort.segment.climb_category
        }, function (err, res) {
        if (err) {
          callback('Error updating challenge with user effort: ' + util.stringify(err));
        } else {
          console.log('Updated challenge with user effort: ' + !!res.nModified);
        }
      });
    } else if (userRole === 'challengee') {
      Challenge.update({ _id: challenge.id },
        {
          challengeeTime: effort.elapsed_time,
          challengeeCompleted: true,
          challengeeAvgCadence: effort.average_cadence || 0,
          challengeeAvgWatts: effort.average_watts || 0,
          challengeeAvgHeartrate: effort.average_heartrate || 0,
          challengeeMaxHeartRate: effort.max_heartrate || 0,
          segmentDistance: effort.segment.distance,
          segmentAverageGrade: effort.segment.average_grade,
          segmentMaxGrade: effort.segment.maximum_grade,
          segmentElevationHigh: effort.segment.elevation_high,
          segmentElevationLow: effort.segment.elevation_low,
          segmentClimbCategory: effort.segment.climb_category
        }, function (err, res) {
        if (err) {
          callback('Error updating challenge with user effort: ' + util.stringify(err));
        } else {
          console.log('Updated challenge with user effort: ' + !!res.nModified);
        }
      });
    }
  })
  .then(function(){
    // Checks if the challenge has a winner
    checkForWinner(challenge.id, function(err, res) {
      if (err) {
        callback('Error checking for winner: ' + err);
      } else {
        callback(err, 'Successfully checked for winner: ' + res);
      }
    });
  })
  .catch(function(error) {
    callback(error);
  });
};

module.exports.getChallenges = function (user, status, callback) {
  if (!user) callback('No user defined');
  if (!status) callback('No status defined');
  if (status === 'complete') {
    Challenge
    .find({
      $or: [
        { challengerId: user, challengerCompleted: true },
        { challengeeId: user, challengeeCompleted: true }
      ],
    })
    .sort([['updatedAt','descending'],['expires','descending']])
    .exec(function (err, challenges) {
      if (err) {
        callback('error finding completed challenges: ' + err);
      } else {
        callback(err, challenges);
      }
    });
  } else if (status === 'active') {
    Challenge
    .find({
      $or: [
        { challengerId: user, challengerCompleted: false, status: status },
        { challengeeId: user, challengeeCompleted: false, status: status }
      ]
    })
    .sort({ expires: 'ascending' })
    .exec(function (err, challenges) {
      if (err) {
        callback('error finding active challenges: ' + err);
      } else {
        callback(err, challenges);
      }
    });
  } else if (status === 'pending') {
    Challenge.find({
      $or: [
        { challengeeId: user, status: 'pending' },
        { challengerId: user, status: 'pending' }
      ]
    })
    .sort({ expires: 'ascending' })
    .exec(function (err, challenges) {
      if (err) {
        callback('error finding pending challenges: ' + err);
      } else {
        callback(err, challenges);
      }
    });
  } else {
    callback('Error getting challenges');
  }
};

// Helper functions
function saveSegmentToChallenge(challengeId, segmentId) {
  Segments.find({ _id: segmentId }, function (err, res) {
    if (err) {
      console.error('save segment error: ' + err);
    }
    if (res.length) {
      var segment = res[0];
      Challenge.update({ _id: challengeId },
        {
          segmentActivityType: segment.activityType,
          segmentDistance: segment.distance,
          segmentAverageGrade: segment.averageGrade,
          segmentClimbCategory: segment.climbCategory,
          segmentCity: segment.city,
          segmentState: segment.state,
          segmentCountry: segment.country,
          segmentElevationGain: segment.totalElevationGain
        },
        function (err, raw) {
          if (err) console.error(err);
          console.log('Updated challenge with segment details:' + !!res.nModified);
        });
    }
  });
}

function updateChallengeResult(challenge) {
  var completeDate = new Date();
  console.log('updating challenge');
  Challenge.find({_id: challenge._id}, function(err, res){
    if (res.length) {
      console.log('found challenge to update');
      var challenge = res[0];
      // If challengee is the only user who completed challenge
      if (challenge.challengeeCompleted) {
        Challenge.update({ _id: challenge._id }, {
          winnerId: challenge.challengeeId,
          winnerName: challenge.challengeeName,
          loserId: challenge.challengerId,
          loserName: challenge.challengerName,
          expired: true,
          challengerCompleted: true,
          status: 'complete',
          completed: completeDate.toISOString()
        }, function (err, raw) {
          if (err) {
            console.log(err);
          }
        });
      // If challenger is the only user who completed challenge
      } else if (challenge.challengerCompleted) {
          Challenge.update({ _id: challenge._id }, {
          winnerId: challenge.challengerId,
          winnerName: challenge.challengerName,
          loserId: challenge.challengeeId,
          loserName: challenge.challengeeName,
          expired: true,
          challengeeCompleted: true,
          status: 'complete',
          completed: completeDate.toISOString()
        }, function (err, raw) {
          if (err) {
            console.log(err);
          }
        });
      }
    }
  });
}

function checkForWinner (challengeId, callback) {
  Challenge
  .find({ _id: challengeId })
  .then(function (challenges) {
    var challenge = challenges[0];
    var winner;
    // If challenge is complete
    if (challenge.challengerTime && challenge.challengeeTime) {
      if (challenge.challengerTime === challenge.challengeeTime) {
        callback(null, 'Challenge resulted in a tie');
      } else {
        winner = challenge.challengerTime < challenge.challengeeTime ? 'challenger' : 'challengee';
      }
      // Update wins or losses and challenge count for both users
      if (winner === 'challenger') {
        Users.incrementWins(challenge.challengerId, challenge.challengeeId);
        Users.incrementLosses(challenge.challengeeId, challenge.challengerId);
        updateChallengeWinnerAndLoser(challengeId, challenge.challengerId,
          challenge.challengerName, challenge.challengeeId, challenge.challengeeName, callback);
      } else if (winner === 'challengee') {
        Users.incrementWins(challenge.challengeeId, challenge.challengerId);
        Users.incrementLosses(challenge.challengerId, challenge.challengeeId);
        updateChallengeWinnerAndLoser(challengeId, challenge.challengeeId, challenge.challengeeName, challenge.challengerId, challenge.challengerName, callback);
      }
      // Updates challenge status to 'Complete'
      Challenge.update({ _id: challengeId }, { status: 'complete' }, function (err, raw) {
        if (err) {
          callback('Error updating challenge status to \'Complete\'');
        }
      });
    } else {
      callback(null, 'Effort has been updated, waiting for other user to complete');
    }
  })
  .catch(function(error) {
    callback('Error checking for winner: ' + error)
  });
}

function updateChallengeWinnerAndLoser (challengeId, winnerId, winnerName, loserId, loserName, cb) {
  var completeDate = new Date();
  Challenge.update({ _id: challengeId},
    {
      winnerId: winnerId,
      winnerName: winnerName,
      loserId: loserId,
      loserName: loserName,
      expired: true,
      completed: completeDate.toISOString()
    },
    function (err) {
      if (err) {
        cb('Error updating challenge winner/loser:' + util.stringify(err), null);
      } else {
        cb(null, 'Challenge updated with winner and loser');
      }
    });
}
