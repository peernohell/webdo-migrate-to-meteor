Migrations = new Mongo.Collection('migrations');
Errors = new Mongo.Collection('errors');


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
    collection: {},
    Meteor: null,
    data: null,
    from: function (mysqlInfo) {
      console.log('from', mysqlInfo);
      Migration.mysql.connection = mysql.createConnection(mysqlInfo);
      Migration.mysql.connection.connect();
      return Migration;
    },
    to: function (url) {
      Migration.meteor = DDP.connect(url);
      return Migration;
    },
    start: function () {
      console.log('start: ddp status', Migration.meteor.status().status);
      if (Migration.meteor.status().status === 'connecting') {
        Migration.meteor.onReconnect = Migration.startMigration;
      } else {
        Migration.startMigration();
      }
    },
    startMigration: function () {
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
        //Migration.commentaire();
        //Migration.partage
      } catch (e) {
        // error during downloading data from mysq
        console.log('error during download of data on mysql', e);
      }
    },
    checkData: function () {
      if (!Migration.meteor) throw new Error('Migration: no DDP target');
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
        names = [
          'membre',
          'groupe',
          'kdo',
          'commentaire',
          'partage'
        ],
        errors = [],
        toResolved = names.length;

        names.forEach(function (name) {
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
      getCollection: function (name) {
        if (!Migration.collection[name])
          Migration.collection[name] = new Mongo.Collection(name, Migration.meteor);
        return Migration.collection[name];

      },
      createUserFromMembre: function (membre) {
        return {
          // email must not contain capital
          email: membre.prenom.toLowerCase() + '@ploki.info',
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
        var
        Users = Migration.mongo.getCollection('users'),
        user = Users.findOne({'profile.migrationId': kdo.pour});

        if (!user)
          throw new Error('Convertion Gifts [' + kdo.id + "]: can't find user " + kdo.pour);
        return {
          title: kdo.titre,
          link: kdo.url,
          image: kdo.image,
          detail: kdo.description.toString(),
          priority: Number(kdo.priorite),
          ownerId: user._id,
          createdAt: new Date(kdo.creeLe),
          archiverId: kdo.supprime === '1' ? user._id : ''//,
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
      }

    },
    users: function () {
      var Users = Migration.mongo.getCollection('users');

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
        try {
          var user = Users.findOne({'profile.migrationId': Number(membre.id)});
          Migration.mysql.data.membre.byId[membre.id] = membre;
          if (user) return usersData.alreadyMigrated++;
          user = Migration.mongo.createUserFromMembre(membre);
          Migration.meteor.call('createUser', user);
          usersData.migrated++;
        } catch (e) {
          // if error, remove from cache
          delete Migration.mysql.data.membre.byId[membre.id];
          e.context = 'create user';
          Errors.insert(e);
          usersData.migrationFailed++;
        }
      });
      Migrations.insert(usersData);
    },
    gifts: function () {
      var Gifts = Migration.mongo.getCollection('gifts');
      console.log('gifts', Gifts.find().fetch());

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
          var gift = Gifts.findOne({migrationId: Number(kdo.id)});
          if (gift) return giftsData.alreadyMigrated++;
          gift = Migration.mongo.createGiftFromKdo(kdo);
          // login with owner account
          var membre = Migration.mysql.data.membre.byId[kdo.pour] = membre;
          if (!membre) {
            giftsData.migrationFailed++;
            throw new Meteor.Error('gift-membre-not-found', "can't find membre " + kdo.pour + ' for gift ' + kdo.id);
          }

          var error = Migration.meteor.loginWithPassword(membre.prenom, membre.motPasse);
          if (error)
            throw error;

          Gifts.insert(gift);
          giftsData.migrated++;

        } catch (e) {
          e.context = 'create gift';
          console.log('Error: failed to create kdo ', kdo, e);
          Errors.insert(e);
          giftsData.migrationFailed++;
        }
      });
      Migrations.insert(giftsData);
    }
  };

  Meteor.startup(function () {
    // clear last migrations information.
    Migrations.remove({});
    Errors.remove({});

    Meteor.methods({
      users: function (mysqlInfo, mongoURL) {

        console.log('migration from ', mysqlInfo, 'to', mongoURL);
        Migration.from(mysqlInfo).to(mongoURL).start();
      }
    });
  });
})();
}
