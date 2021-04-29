'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const https = require('https');
const fs = require( 'fs' );

const { component, xml, jid} = require("@xmpp/component");
const id = require("@xmpp/id");
const debug = require("@xmpp/debug");

const wait = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

const domain = 'component.localhost';
const resource = 'resource';

const xmpp = component({
  service: "xmpp://localhost:5347",
  domain: domain,
  password: "mysecretcomponentpassword",
});

const lineevents= {};

// create LINE SDK config from env variables
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// create LINE SDK client
const lineClient = new line.Client(lineConfig);

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// Cert files as https options.
let ex_options = {
  key: fs.readFileSync( './certs/privkey.pem' ),
  cert: fs.readFileSync( './certs/fullchain.pem' )
};

let rosters = {};
if(fs.existsSync('./rosters.json')){
  rosters = JSON.parse(fs.readFileSync('./rosters.json', 'utf8'));
}
const xmpprosters = rosters.xmpp;
const lineusers = rosters.line;

process.on('exit', function() {
  console.log('saving.....');
  fs.writeFileSync('./rosters.json', JSON.stringify(rosters));
});

process.on('SIGINT', function() {
  process.exit(1);
});


debug(xmpp, true);

xmpp.on("online", async (address) => {
  console.log("online as", address.toString());
});

xmpp.on("error", (err) => {
  console.error(err);
});

xmpp.on("offline", () => {
  console.log("offline");
});

xmpp.on("stanza", async (stanza) => {
  switch(stanza.name){
    case "message":
      await xmpp2line(stanza);
      break;
    case "presence":
      await xmpppresence(stanza);
      break;
  }
  return;
});

// register a webhook handler with middleware
// about the middleware, please refer to doc
app.post('/callback', line.middleware(lineConfig), (req, res) => {
  Promise
    .all(req.body.events.map(line2xmpp))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function xmpppresence(stanza) {
// To:
  if(!stanza.attrs.to.match(/@/) ||
      stanza.attrs.to.split('@')[1].split('/')[0] != domain){
    return;
  }
  const lineuid = stanza.attrs.to.split('@')[0];
  if(!lineusers[lineuid])
    return;
//
// RCV Presence
//
  if(!stanza.is('presence')) return;
  switch(stanza.attrs.type){
    case 'subscribe':
      if(xmpprosters[stanza.attrs.from]){
        await xmpp.send(xml('presence', 
          {
            to: stanza.attrs.from,
            from: stanza.attrs.to,
            id: stanza.attrs.id,
            type: 'subscribed'
        }));
        xmpprosters[stanza.attrs.from] = 'subscribed';
        wait(100);
        await xmpp.send(xml('presence',
          {
            to: stanza.attrs.from,
            from: stanza.attrs.to,
            id: id(),
            type: 'subscribe'
          },
          lineusers[lineuid]['LineName'] ? xml("nick", {xmlns:'http://jabber.org/protocol/nick'}, lineusers[lineuid]['LineName']['name']):null
        ));
       return;
      }
      break;
    case 'unsubscribe':
      if(xmpprosters[stanza.attrs.from]){
        xmpprosters[stanza.attrs.from] = 'unsubscribed';
        await xmpp.send(xml('presence', 
          {
            to: stanza.attrs.from,
            from: stanza.attrs.to,
            id: stanza.attrs.id,
            type: 'unsubscribed'
        }));
      }
      break;
    case 'probe':
      await xmpp.send(xml('presence',
          {
            to: stanza.attrs.from,
            from: lineuid + '@' + domain + '/' + resource,
            id: stanza.attrs.id,
          }));
      break;
  }
  return;
}
async function xmpp2line(stanza) {
// To:
  if(!stanza.attrs.to.match(/@/) ||
      stanza.attrs.to.split('@')[1].split('/')[0] != domain){
    return;
  }
  const lineuid = stanza.attrs.to.split('@')[0];
  if(!lineusers[lineuid])
    return;
// From:
  if(!xmpprosters[stanza.attrs.from.split('/')[0]]){
    return;
  }
//
// RCV Chat Text
  if(stanza.attrs.type=='chat'){
    if(!lineusers[lineuid]) {
      console.log('No correponding lineuser....');
      return;
    }
    const message = { type: 'text', text: stanza.getChildText("body")};
    if(lineevents[lineuid]){
	const replyToken = lineevents[lineuid]['token'];
	delete lineevents[lineuid];
        return lineClient.replyMessage(replyToken, message);
    }else{
        return lineClient.pushMessage(lineusers[lineuid]['lineId'], message);
    }
  }
  return;
}

async function line2xmpp(event) {
  let first = false;
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null);
  }
  const from = event.source.userId;
  const lineuid = from.toLowerCase();
  lineevents[lineuid] = {token:event.replyToken, timestamp:Date.now()};

  if(!lineusers[lineuid]){
    lineusers[lineuid] = {lineId: from};
  }

  if(!lineusers[lineuid]['LineName']){
    first = true;
    let profile = await lineClient.getProfile(from);
    lineusers[lineuid]['LineName'] = {name:profile.displayName, timestamp:Date.now()};
  }

  const to = rosters.representive;
  const message = xml(
    "message",
    { type: "chat", from: from + '@' + domain + '/' + resource, to: to, id: event.message.id},
    xml("body", {}, event.message.text),
    first ? xml("nick", {xmlns:'http://jabber.org/protocol/nick'}, lineusers[lineuid]['LineName']['name']):null
  );
  await xmpp.send(message);
  return Promise.resolve(null);
}

const server = https.createServer( ex_options, app ).listen( 3000, function(){
  console.log( 'server stating on ' + 3000 + ' ...' );
});

//process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
xmpp.start().catch(console.error);
