'use strict';

const nodemailer = require('nodemailer');
const assert = require('assert');

module.exports = app => {
    app.addSingleton('email', createOneClient);
};

function createOneClient(config, app) {
    
    app.coreLogger.info('[egg-email] connecting success!');

    const smtpTransport = nodemailer.createTransport(config);

    return smtpTransport;
}   
