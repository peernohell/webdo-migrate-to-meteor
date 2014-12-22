Migrations = new Mongo.Collection('migrations');
Errors = new Mongo.Collection('errors');
Gifts = new Mongo.Collection('gifts');
Users = Meteor.users;


if (Meteor.isClient) {
(function () {
  'use strict';
  // counter starts at 0
  Session.setDefault('counter', 0);

  Template.users.helpers({
    errors: function () {
      return Errors.find();
    },
    migrations: function () {
      return Migrations.find();
    }
  });

  Template.users.events({
    'submit form#mysql': function (e) {
      // increment the counter when button is clicked
      var form = e.currentTarget;
      if (!form) return;

      console.log('client: call users');
      Meteor.call(
        'users', {
          host: form.host.value,
          database: form.database.value,
          user: form.user.value,
          password: form.password.value
        },
        form.url.value,
        function (err) {
          if (err) return console.log('error' + err);
          console.log('Meteor.call users is finished!');
        }
      );
    }
  });
})();
}

if (Meteor.isServer) {
(function () {
  'use strict';

  var
  Migration = {
    data: null,
    from: function (mysqlInfo) {
      console.log('from', mysqlInfo);
      Migration.mysql.connection = mysql.createConnection(mysqlInfo);
      Migration.mysql.connection.connect();
      return Migration;
    },
    start: function () {
      // clean data
      Users.remove({});
      Gifts.remove({});

      console.log('startMigration');
      // get mysql (from) data
      try {
        Meteor.wrapAsync(Migration.mysql.getData)();
        console.log('startMigration: wrapAsync ok');
        Migration.users();
        console.log('startMigration: migration users ok');
        //Migration.groupe();
        //console.log('startMigration: migration groupe ok');
        Migration.gifts();
        console.log('startMigration: migration gifts ok');
        Migration.commentaire();
        //Migration.partage
      } catch (e) {
        // error during downloading data from mysq
        console.log('error during download of data on mysql', e);
      }
    },
    checkData: function () {
      if (!Migration.mysql.data) throw new Error('Migration: no data to migrate');
    },
    mysql: {
      connection: null,
      data: {},
      getTableData: function (name, callback) {
        Migration.mysql.connection.query('SELECT * FROM ' + name, function (err, rows, fields) {
          if (err) return callback(err);

          Migration.mysql.data[name] = {
            rows: rows,
            fields: fields,
            name: name
          };
          callback(null);
        });
      },
      getData: function (callback) {
        var
          errors = [],
          toResolved = 5;

        [
          'membre',
          'groupe',
          'kdo',
          'commentaire',
          'partage'
        ].forEach(function (name) {
          Migration.mysql.getTableData(name, function (err) {
            toResolved--;
            if (err)
              errors.push(err);

            if (!toResolved)
              callback(errors.length ? errors : null);
          });
        });
      }
    },
    mongo: {
      createUserFromMembre: function (membre) {
        return {
          username: membre.prenom,
          password: membre.motPasse,
          profile: {
            name: membre.prenom,
            birthday: membre.anniversaire,
            description: membre.presentation.toString(),
            migrationId: membre.id
          }
        };
      },
      createGiftFromKdo: function (kdo) {
        var user = Users.findOne({'profile.migrationId': Number(kdo.pour)});

        if (!user)
          throw new Error('Convertion Gifts [' + kdo.id + "]: can't find user " + kdo.pour);

        return {
          _id: String(kdo.id),
          title: kdo.titre,
          link: kdo.url,
          image: kdo.image,
          detail: kdo.description.toString(),
          priority: Number(kdo.priorite),
          ownerId: user._id,
          createdAt: new Date(kdo.creeLe),
          archived: kdo.supprime === 1
          /*
          notMigrated: {
            creePar: kdo.creePar,
            reserveLe: kdo.reserveLe,
            reservePar: kdo.reservePar,
            acheteLe: kdo.acheteLe,
            achetePar: kdo.achetePar,
            partage: kdo.partage,
            supprime: kdo.supprime
          }
          // */
        };
      },
      createCommentsFromCommentaire: function (commentaire) {
        var user = Users.findOne({'profile.migrationId': Number(commentaire.creePar)});

        if (!user)
          throw new Error('Convertion Comment [' + commentaire.id + "]: can't find user " + commentaire.creePar);

        return {
          message: commentaire.description.toString(),
          createdAt: new Date(commentaire.creeLe),
          author: user.profile.name,
          visible: !!commentaire.visible,
          remove: !!commentaire.supprime
        };
      }

    },
    users: function () {

      Migration.checkData();
      var usersData = {
        name: 'users',
        toMigrate: Migration.mysql.data.membre.rows.length,
        migrated: 0,
        alreadyMigrated: 0,
        migrationFailed: 0
      };
      // cache to find membre by their id
      Migration.mysql.data.membre.byId = [];

      Migration.mysql.data.membre.rows.forEach(function (membre) {
        console.log('membre', membre);
        try {
          // check if user is already in database
          var user = Users.findOne({'profile.migrationId': Number(membre.id)});
          Migration.mysql.data.membre.byId[membre.id] = membre;
          if (user) return usersData.alreadyMigrated++;

          user = Migration.mongo.createUserFromMembre(membre);
          Meteor.call('createUser', user);
          usersData.migrated++;
        } catch (e) {
          // if error, remove from cache
          delete Migration.mysql.data.membre.byId[membre.id];
          e.context = 'create user';
          Errors.insert(new Meteor.Error(e));
          usersData.migrationFailed++;
        }
      });
      Migrations.insert(usersData);
    },
    gifts: function () {
      //console.log('gifts', Gifts.find().fetch());

      Migration.checkData();

      var giftsData = {
        name: 'kdo',
        toMigrate: Migration.mysql.data.kdo.rows.length,
        migrated: 0,
        alreadyMigrated: 0,
        migrationFailed: 0
      };

      Migration.mysql.data.kdo.rows.forEach(function (kdo) {
        try {
          var gift = Gifts.findOne(Number(kdo.id));
          if (gift) return giftsData.alreadyMigrated++;
          gift = Migration.mongo.createGiftFromKdo(kdo);
          // login with owner account
          var membre = Migration.mysql.data.membre.byId[kdo.pour];
          if (!membre) {
            giftsData.migrationFailed++;
            throw new Meteor.Error('gift-membre-not-found', "can't find membre " + kdo.pour + ' for gift ' + kdo.id);
          }

          Gifts.insert(gift);
          giftsData.migrated++;

        } catch (e) {
          e.context = 'create gift';
          console.log('Error: failed to create kdo ', kdo, e);
          Errors.insert(new Meteor.Error(e));
          giftsData.migrationFailed++;
        }
      });
      Migrations.insert(giftsData);
    },
    commentaire: function () {

      Migration.checkData();

      var
      giftsComments = {},
      commentsData = {
        name: 'comments',
        toMigrate: Migration.mysql.data.kdo.rows.length,
        migrated: 0,
        alreadyMigrated: 0,
        migrationFailed: 0
      };

      Migration.mysql.data.kdo.rows.reduce(function (giftsComments, commentaire) {
        try {
          var gift = Gifts.findOne(Number(commentaire.idKdo));
          if (gift)
            throw new Meteor.Error('comments-kdo-not-found', "can't find kdo " + commentaire.idKdo + ' for comments ' + commentaire.id);

          var comment = Migration.mongo.createCommentsFromCommentaire(commentaire);
          if (!giftsComments[commentaire.idKdo]) {
            giftsComments[commentaire.idKdo] = [];
            giftsComments.list.push(giftsComments[commentaire.idKdo]);
          }
          giftsComments[commentaire.idKdo].push(comment);

        } catch (e) {
          e.context = 'create comment';
          console.log('Error: failed to create comment ', commentaire, e);
          Errors.insert(new Meteor.Error(e));
          commentsData.migrationFailed++;
        }

        return giftsComments;
      }, giftsComments);

      Object.keys(giftsComments).forEach(function (giftId) {
        var comments = giftsComments[giftId];
        // sort comment by date
        comments = comments.sort(function (a, b) {
          return a - b;
        });
        console.log('gift ', giftId, ' have :', comments.length, ' comments');
        Gifts.update(giftId, { $set: { commments: comments}});

      });

      Migrations.insert(commentsData);
    }
  };

  Meteor.startup(function () {
    // clear last migrations information.
    Migrations.remove({});
    Errors.remove({});

    Meteor.methods({
      users: function (mysqlInfo, mongoURL) {

        console.log('migration from ', mysqlInfo, 'to', mongoURL);
        Migration.from(mysqlInfo).start();
      }
    });
  });
})();
}
