'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const https = require('https');
const fs = require( 'fs' );

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// create LINE SDK client
const client = new line.Client(config);

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

var options = {
  key: fs.readFileSync( './linexmpp.shikob.net/privkey.pem' ),
  cert: fs.readFileSync( './linexmpp.shikob.net/fullchain.pem' )
};



// register a webhook handler with middleware
// about the middleware, please refer to doc
app.post('/callback', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// event handler
function handleEvent(event) {
  console.log(event);
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null);
  }

  // create a echoing text message
  const echo = { type: 'text', text: event.message.text };

  // use reply API
  return client.replyMessage(event.replyToken, echo);
}


var server = https.createServer( options, app ).listen( 3000, function(){
  console.log( "server stating on " + 3000 + " ..." );
});
