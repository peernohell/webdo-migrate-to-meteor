if (Meteor.isClient) {
  // counter starts at 0
  Session.setDefault("counter", 0);

  Template.users.helpers({
    users: function () {
      var u = Session.get("users");
      return u && Object.keys(u).map(function (name) {
        return u[name];
      }) || false;
    }
  });

  Template.users.events({
    'submit form': function (e, template) {
      // increment the counter when button is clicked
      var form = e.currentTarget;
      if (!form) return;

      Meteor.call(
      'users',
      form.host.value,
      form.database.value,
      form.user.value,
      form.password.value,
      function (err, users) {
        if (err) return alert('error' + err);
        Session.set("users", users);
      });
      return false;
    }
  });
}

if (Meteor.isServer) {

  function getTableData (name, data, callback) {
      connection.query('SELECT * FROM ' + name, function (err, rows, fields) {
        if (err) return callback(err);
        data[name] = {
          rows: rows,
          fields: fields,
          name: name
        };
        callback(null, data);
      });
  }

  function getTablesData(names, data, callback) {
    var
    errors = [],
    toResolved = names.length;
    names.forEach(function (name) {
      getTableData(name, data, function (err, data) {
        toResolved--;
        if (err)
          errors.push(err);

        if (!toResolved)
          callback(errors.length ? errors: null, data);
      }); 
    });
  }

  function getUsers (callback) {
      var data = {};
      getTablesData([
        'commentaire',
        'groupe',
        'kdo',
        'membre',
        'partage'
      ], data, callback);
  }

  Meteor.startup(function () {
    Future = Npm.require('fibers/future');


    Meteor.methods({
      users: function (host, database, user, password) {
        connection = mysql.createConnection({
          host     : host,
          database : database,
          user     : user,
          password : password
        });

        connection.connect();

        var users =  Meteor.wrapAsync(getUsers)();
        return users;
      }
    });
  });
}
