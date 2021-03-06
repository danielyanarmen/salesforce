var passport = require('passport');
var bcrypt = require('bcrypt-nodejs');
var config = require('config');
var jsforce = require('jsforce');
var validator = require('validator');
var request = require('request');
var debug = require('debug')('route');

var Model = require('../models/model');

var jsforceOAuth2 = new jsforce.OAuth2(config.get('jsforce'));
var conn = new jsforce.Connection({oauth2 : jsforceOAuth2});
var connCreds = config.get('sfadmin');


var index = function (req, res, next) {

    if (!req.isAuthenticated()) {
        res.redirect('/signin');
    } else {

        var user = req.user;

        if (user !== undefined) {
            user = user.toJSON();
        }

        conn.login(connCreds.username, connCreds.password + connCreds.clientsecret, function(err, userInfo) {
            if (err) { return console.error(err); }

            conn.query("SELECT Id, Name, Email FROM Contact WHERE Email = '" + user.email + "'", function(err, result) {
                if (err) { return console.error(err); }

                if(result.records.length > 0) {
                    res.render('index', {title: 'Home', user: user});
                } else {
                    res.render('index_limited', {title: 'Home', user: user});
                }
            });

        });


        /**
         * Refresh access token
         */
        if(user.sf_accessToken) {
            var conn2 = new jsforce.Connection({
                oauth2: jsforceOAuth2,
                instanceUrl: user.sf_instanceURL,
                accessToken: user.sf_accessToken,
                refreshToken: user.sf_refreshToken
            });
            conn2.on("refresh", function (accessToken, res) {
                new Model.User({ID: user.ID})
                    .save({
                        sf_accessToken: accessToken
                    }, {patch: true})
                    .then(function (model) {
                        console.log(model);
                    });
                debug('Refresh Token:', accessToken);
            });

            conn2.chatter.resource('/users/me').retrieve(function (err, res) {
                if (err) {
                    return console.error(err);
                }
                debug("username: " + res.username);
            });
        }

    }
};

var indexPost = function (req, res, next) {
    if (!req.isAuthenticated()) {
        res.json({"status":"ERROR", "msg":"You are not authorized."});
    } else {

        var user = req.user;

        if (user !== undefined) {
            user = user.toJSON();
        }

        if(req.body.action == 'save_contact_info') {
            new Model.User({ID: user.ID})
                .save({
                    first_name  : req.body.contact_first_name,
                    last_name   : req.body.contact_last_name,
                    SSN         : req.body.contact_SSN,
                    birth_date  : req.body.contact_birth_date,
                    phone       : req.body.contact_phone,
                    email       : req.body.contact_email,
                    address     : req.body.contact_address,
                    city        : req.body.contact_city,
                    state       : req.body.contact_state,
                    zip         : req.body.contact_zip
                })
                .then(function(model){

                    conn.login(connCreds.username, connCreds.password + connCreds.clientsecret, function(err, userInfo) {
                        if (err) { return console.error(err); }

                        conn.query("SELECT Id FROM Contact WHERE Email = '" + user.email + "'", function(err, result) {
                            if (err) { return console.error(err); }

                            if(result.records.length > 0) {
                                conn.sobject("Contact").update({
                                    Id                  : result.records[0].Id,
                                    FirstName           : req.body.contact_first_name,
                                    LastName            : req.body.contact_last_name,
                                    Birthdate           : req.body.contact_birth_date,
                                    Phone               : req.body.contact_phone,
                                    Email               : req.body.contact_email,
                                    MailingStreet       : req.body.contact_address,
                                    MailingCity         : req.body.contact_city,
                                    MailingState        : req.body.contact_state,
                                    MailingPostalCode   : req.body.contact_zip

                                }, function(err, ret) {
                                    if (err || !ret.success) { return console.error(err, ret); }
                                    debug('SF Updated Successfully : ' + ret.id);

                                    res.json({"status":"OK", "msg":"Satatus Message"});
                                });
                            }
                        });
                    });


                });


        }

        if(req.body.action == 'salesforce_disconnect') {
            new Model.User({ID: req.body.id})
                .save({
                    sf_accessToken: '',
                    sf_refreshToken: '',
                    sf_instanceURL: '',
                    sf_userID: '',
                    sf_organisationID: ''
                }, {patch: true})
                .then(function(model){
                    res.json({"status":"OK", "msg":"Satatus Message"});
                })
        }
    }
};

var signIn = function (req, res, next) {
    if (req.isAuthenticated())
        res.redirect('/');

    res.render('signin', {title: 'Sign In'});
};

var signInPost = function (req, res, next) {
    passport.authenticate('local', {successRedirect: '/', failureRedirect: '/signin'}, function (err, user, info) {
        if (err) {
            return res.render('signin', {title: 'Sign In', errorMessage: err.message});
        }
        if (!user) {
            return res.render('signin', {title: 'Sign In', errorMessage: info.message});
        }
        return req.logIn(user, function (err) {
            if (err) {
                return res.render('signin', {title: 'Sign In', errorMessage: err.message});
            } else {
                return res.redirect('/');
            }
        });
    })(req, res, next);
};

var signUp = function (req, res, next) {
    if (req.isAuthenticated()) {
        res.redirect('/');
    } else {
        res.render('signup', {title: 'Register'});
    }
};

var signUpPost = function (req, res, next) {
    var user = req.body;

    if (!user.full_name || !user.username || !user.email || !user.password) {
        res.render('signup', {title: 'signup', errorMessage: 'Please, fill in all fields'});
        return;
    } else if (!validator.isEmail(user.email)) {
        res.render('signup', {title: 'signup', errorMessage: 'Please, enter a valid E-Mail address'});
        return;
    }

    var usernamePromise = null;
    usernamePromise = new Model.User({username: user.username}).fetch();
    return usernamePromise.then(function (model) {
        if (model) {
            res.render('signup', {title: 'signup', errorMessage: 'Username already exists'});
        } else {
            var password = user.password;
            var hash = bcrypt.hashSync(password);

            var signUpUser = new Model.User({
                username: user.username,
                password: hash,
                full_name: user.full_name,
                email: user.email
            });
            signUpUser.save().then(function (model) {
                signInPost(req, res, next);
            });
        }
    });
};

var signOut = function (req, res, next) {
    if (!req.isAuthenticated()) {
        res.redirect('/signin');
        //notFound404(req, res, next);
    } else {
        req.logout();
        res.redirect('/signin');
    }
};

var reset = function (req, res, next) {
    if (req.isAuthenticated()) {
        res.redirect('/');
    } else {
        res.render('reset', {title: 'Reset'});
    }
};

var resetPost = function (req, res, next) {
    var email = req.body.email;
    if (req.isAuthenticated()) {
        res.redirect('/');
    } else {
        if(!email) {
            res.render('reset', {title: 'Reset', errorMessage: 'Please, enter your E-Mail address'});
        } else {
            if (!validator.isEmail(email)) {
                res.render('reset', {title: 'Reset', errorMessage: 'Please, enter a valid E-Mail address'});
            } else {
                new Model.User({email: email})
                    .fetch()
                    .then(function (model) {
                        if (!model) {
                            res.render('reset', {title: 'Reset',errorMessage: 'E-Mail address you entered couldn\'t be found'});
                        } else {
                            console.log(model.toJSON());
                            reset(req, res, next);
                        }

                    });
            }
        }
    }

};

var notFound404 = function (req, res, next) {
    res.status(404);
    res.render('404', {title: '404 Not Found'});
};

var salesforceAuth = function (req, res, next){
    res.redirect(jsforceOAuth2.getAuthorizationUrl({ scope : 'api id web refresh_token' }));
};

var salesforceReturn = function (req, res, next){

    if (!req.isAuthenticated()) {
        res.redirect('/signin');
    } else {

        var user = req.user;

        var conn = new jsforce.Connection({oauth2: jsforceOAuth2});
        var code = req.query.code;

        conn.authorize(code, function (err, userInfo) {
            if (err) {
                return console.error(err);
            }

            new Model.User({ID: user.toJSON().ID})
                .save({
                    sf_accessToken: conn.accessToken,
                    sf_refreshToken: conn.refreshToken,
                    sf_instanceURL: conn.instanceUrl,
                    sf_userID: userInfo.id,
                    sf_organisationID: userInfo.organizationId
                }, {patch: true})
                .then(function(model){
                    console.log(model);
                    return res.redirect('/');
                });

        });
    }
};

var netdocuments = function (req, res, next){
    if (!req.isAuthenticated()) {
        res.redirect('/signin');
    } else {
        var qs = config.get('netdocuments');
        res.redirect(qs.uri + '?client_id=' + qs.client_id + '&scope=' + qs.scope + '&response_type=' + qs.response_type + '&redirect_uri=' + qs.redirect_uri);
    }
};

var netdocumentsReturn = function (req, res, next){
    if (!req.isAuthenticated()) {
        res.redirect('/signin');
    } else {
        console.log(req.query.access_token);
        return res.redirect('/');
    }
};






module.exports.index = index;
module.exports.indexPost = indexPost;

module.exports.signIn = signIn;
module.exports.signInPost = signInPost;

module.exports.signUp = signUp;
module.exports.signUpPost = signUpPost;

module.exports.reset = reset;
module.exports.resetPost = resetPost;

module.exports.signOut = signOut;

module.exports.salesforceAuth = salesforceAuth;
module.exports.salesforceReturn = salesforceReturn;

module.exports.netdocuments = netdocuments;
module.exports.netdocumentsReturn = netdocumentsReturn;

module.exports.notFound404 = notFound404;