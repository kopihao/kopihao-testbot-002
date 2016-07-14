//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Builder SDK Github:
// https://github.com/Microsoft/BotBuilder
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import ub = require('./UniversalBot');
import bs = require('../storage/BotStorage');
import events = require('events');
import request = require('request');
import async = require('async');
import url = require('url');
import http = require('http');
import utils = require('../utils');
import logger = require('../logger');
import jwt = require('jsonwebtoken');
var getPem = require('rsa-pem-from-mod-exp');
var base64url = require('base64url');


// Fetch token once per day
var keysLastFetched = 0;
var cachedKeys: IKey[];
var issuer: string;

export interface IChatConnectorSettings {
    appId?: string;
    appPassword?: string;
    endpoint?: IChatConnectorEndpoint;
    stateEndpoint?: string;
}

export interface IChatConnectorEndpoint {
    refreshEndpoint: string;
    refreshScope: string;
    verifyEndpoint: string;
    verifyIssuer: string;
    stateEndpoint: string;
}

export interface IChatConnectorAddress extends IAddress {
    id?: string;            // Incoming Message ID
    serviceUrl?: string;    // Specifies the URL to: post messages back, comment, annotate, delete
    useAuth?: string;
}

export class ChatConnector implements ub.IConnector, bs.IBotStorage {
    private handler: (events: IEvent[], cb?: (err: Error) => void) => void;
    private accessToken: string;
    private accessTokenExpires: number;

    constructor(private settings: IChatConnectorSettings = {}) {
        if (!this.settings.endpoint) {
            this.settings.endpoint = {
                refreshEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                refreshScope: 'https://graph.microsoft.com/.default',
                verifyEndpoint: 'https://api.aps.skype.com/v1/.well-known/openidconfiguration',
                verifyIssuer: 'https://api.botframework.com',
                stateEndpoint: this.settings.stateEndpoint || 'https://state.botframework.com'
            }
        }
    }

    public listen(): IWebMiddleware {
        return (req: IWebRequest, res: IWebResponse) => {
            if (req.body) {
                this.verifyBotFramework(req, res);
            } else {
                var requestData = '';
                req.on('data', (chunk: string) => {
                    requestData += chunk
                });
                req.on('end', () => {
                    req.body = JSON.parse(requestData);
                    this.verifyBotFramework(req, res);
                });
            }
        };
    }

    private ensureCachedKeys(cb: (err: Error, keys: IKey[]) => void ): void {
        var now = new Date().getTime();
        // refetch keys every 24 hours
        if (keysLastFetched < (now - 1000*60*60*24)) {
            var options: request.Options = {
                method: 'GET',
                url: this.settings.endpoint.verifyEndpoint,
                json: true
            };
            
            request(options, (err, response, body) => {
                if (!err && (response.statusCode >= 400 || !body)) {
                    err = new Error("Failed to load openID config: " + response.statusCode);
                }

                if (err) {
                    cb(err, null);
                } else {
                    var openIdConfig = <IOpenIdConfig> body;
                    issuer = openIdConfig.issuer;

                    var options: request.Options = {
                        method: 'GET',
                        url: openIdConfig.jwks_uri,
                        json: true
                    };
                    
                    request(options, (err, response, body) => {
                        if (!err && (response.statusCode >= 400 || !body)) {
                            err = new Error("Failed to load Keys: " + response.statusCode);
                        }
                        if (!err) {
                            keysLastFetched = now;
                        }
                        cachedKeys = <IKey[]> body.keys;
                        cb(err, cachedKeys);
                    });
                }
            });
        }
        else {
            cb(null, cachedKeys);
        }
    }

    private getSecretForKey(keyId: string): string {
        
        for (var i = 0; i < cachedKeys.length; i++) {
            if (cachedKeys[i].kid == keyId) {

                var jwt = cachedKeys[i];
                
                var modulus = base64url.toBase64(jwt.n);

                var exponent = jwt.e;

                return getPem(modulus, exponent);
            }
        }
        return null;
    }

    private verifyEmulatorToken(decodedPayload : any) : boolean {
        var now = new Date().getTime() / 1000;
        return decodedPayload.appid == this.settings.appId &&
               decodedPayload.iss == "https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/" &&
                            now < decodedPayload.exp && now > decodedPayload.nbf;
    }

    private verifyBotFramework(req: IWebRequest, res: IWebResponse): void {
        var token: string;
        var isEmulator = req.body['channelId'] === 'emulator';
        if (req.headers && req.headers.hasOwnProperty('authorization')) {
            var auth = req.headers['authorization'].trim().split(' ');;
            if (auth.length == 2 && auth[0].toLowerCase() == 'bearer') {
                token = auth[1];
            }
        }

        // Verify token
        if (token) {
            req.body['useAuth'] = true;

            this.ensureCachedKeys((err, keys) => {
                if (!err) {
                    var decoded = jwt.decode(token, { complete: true });
                    var now = new Date().getTime() / 1000;

                    // verify appId, issuer, token expirs and token notBefore
                    if (decoded.payload.aud != this.settings.appId || decoded.payload.iss != issuer || 
                        now > decoded.payload.exp || now < decoded.payload.nbf) {
                        // check if the token is from emulator
                        if (this.verifyEmulatorToken(decoded.payload))
                        {
                            this.dispatch(req.body, res);
                        }
                        else 
                        {
                            logger.error('ChatConnector: receive - invalid token. Check bots app ID & Password.')
                            res.status(403);
                            res.end();
                        }   
                    } else {
                        var keyId = decoded.header.kid;
                        var secret = this.getSecretForKey(keyId);

                        try {
                            decoded = jwt.verify(token, secret);
                            this.dispatch(req.body, res);
                        } catch(err) {
                            logger.error('ChatConnector: receive - invalid token. Check bots app ID & Password.')
                            res.status(403);
                            res.end();     
                        }
                    }
                } else {
                    logger.error('ChatConnector: receive - error loading openId config: %s', err.toString());
                    res.status(500);
                    res.end();
                }
            });
        } else if (isEmulator && !this.settings.appId && !this.settings.appPassword) {
            // Emulator running without auth enabled
            logger.warn(req.body, 'ChatConnector: receive - emulator running without security enabled.');
            req.body['useAuth'] = false;
            this.dispatch(req.body, res);
        } else {
            // Token not provided so
            logger.error('ChatConnector: receive - no security token sent. Ensure emulator configured with bots app ID & Password.');
            res.status(401);
            res.end();
        }
    }

    public onEvent(handler: (events: IEvent[], cb?: (err: Error) => void) => void): void {
        this.handler = handler;
    }
    
    public send(messages: IMessage[], done: (err: Error) => void): void {
        async.eachSeries(messages, (msg, cb) => {
            try {
                if (msg.address && (<IChatConnectorAddress>msg.address).serviceUrl) {
                    this.postMessage(msg, cb);
                } else {
                    logger.error('ChatConnector: send - message is missing address or serviceUrl.')
                    cb(new Error('Message missing address or serviceUrl.'));
                }
            } catch (e) {
                cb(e);
            }
        }, done);
    }

    public startConversation(address: IChatConnectorAddress, done: (err: Error, address?: IAddress) => void): void {
        if (address && address.user && address.bot && address.serviceUrl) {
            // Issue request
            var options: request.Options = {
                method: 'POST',
                url: url.resolve(address.serviceUrl, '/v3/conversations'),
                body: {
                    bot: address.bot,
                    members: [address.user] 
                },
                json: true
            };
            this.authenticatedRequest(options, (err, response, body) => {
                var adr: IChatConnectorAddress;
                if (!err) {
                    try {
                        var obj = typeof body === 'string' ? JSON.parse(body) : body;
                        if (obj && obj.hasOwnProperty('id')) {
                            adr = utils.clone(address);
                            adr.conversation = { id: obj['id'] };
                            if (adr.id) {
                                delete adr.id;
                            }
                        } else {
                            err = new Error('Failed to start conversation: no conversation ID returned.')
                        }
                    } catch (e) {
                        err = e instanceof Error ? e : new Error(e.toString());
                    }
                } 
                if (err) {
                    logger.error('ChatConnector: startConversation - error starting conversation.')
                }
                done(err, adr);
            });
        } else {
            logger.error('ChatConnector: startConversation - address is invalid.')
            done(new Error('Invalid address.'))
        }
    }

    public getData(context: bs.IBotStorageContext, callback: (err: Error, data: IChatConnectorStorageData) => void): void {
        try {
            // Build list of read commands
            var root = this.getStoragePath(context.address);
            var list: any[] = [];
            if (context.userId) {
                // Read userData
                if (context.persistUserData) {
                    list.push({ 
                        field: 'userData', 
                        url: root + '/users/' + encodeURIComponent(context.userId) 
                    });
                }
                if (context.conversationId) {
                    // Read privateConversationData
                    list.push({ 
                        field: 'privateConversationData',
                        url: root + '/conversations/' + encodeURIComponent(context.conversationId) +
                                    '/users/' + encodeURIComponent(context.userId)
                    });
                }
            }
            if (context.persistConversationData && context.conversationId) {
                // Read conversationData
                list.push({ 
                    field: 'conversationData',
                    url: root + '/conversations/' + encodeURIComponent(context.conversationId)
                });
            }

            // Execute reads in parallel
            var data: IChatConnectorStorageData = {};
            async.each(list, (entry, cb) => {
                var options: request.Options = {
                    method: 'GET',
                    url: entry.url,
                    json: true
                };
                this.authenticatedRequest(options, (err: Error, response: http.IncomingMessage, body: IChatConnectorState) => {
                    if (!err && body) {
                        try {
                            var botData = body.data ? body.data : {};
                            (<any>data)[entry.field + 'Hash'] = JSON.stringify(botData);
                            (<any>data)[entry.field] = botData;
                        } catch (e) {
                            err = e;
                        }
                    }
                    cb(err);
                });
            }, (err) => {
                if (!err) {
                    callback(null, data);
                } else {
                    callback(err instanceof Error ? err : new Error(err.toString()), null);
                }
            });
        } catch (e) {
            callback(e instanceof Error ? e : new Error(e.toString()), null);
        }
    }

    public saveData(context: bs.IBotStorageContext, data: IChatConnectorStorageData, callback?: (err: Error) => void): void {
        var list: any[] = [];
        function addWrite(field: string, botData: any, url: string) {
            var hashKey = field + 'Hash'; 
            var hash = JSON.stringify(botData);
            if (!(<any>data)[hashKey] || hash !== (<any>data)[hashKey]) {
                (<any>data)[hashKey] = hash;
                list.push({ botData: botData, url: url });
            }
        }
        
        try {
            // Build list of write commands
            var root = this.getStoragePath(context.address);
            if (context.userId) {
                if (context.persistUserData)
                {
                    // Write userData
                    addWrite('userData', data.userData || {}, root + '/users/' + encodeURIComponent(context.userId));
                }
                if (context.conversationId) {
                    // Write privateConversationData
                    var url = root + '/conversations/' + encodeURIComponent(context.conversationId) +
                                     '/users/' + encodeURIComponent(context.userId);
                    addWrite('privateConversationData', data.privateConversationData || {}, url);
                }
            }
            if (context.persistConversationData && context.conversationId) {
                // Write conversationData
                addWrite('conversationData', data.conversationData || {}, root + '/conversations/' + encodeURIComponent(context.conversationId));
            }

            // Execute writes in parallel
            async.each(list, (entry, cb) => {
                var options: request.Options = {
                    method: 'POST',
                    url: entry.url,
                    body: { eTag: '*', data: entry.botData },
                    json: true
                };
                this.authenticatedRequest(options, (err, response, body) => {
                    cb(err);
                });
            }, (err) => {
                if (callback) {
                    if (!err) {
                        callback(null);
                    } else {
                        callback(err instanceof Error ? err : new Error(err.toString()));
                    }
                }
            });
        } catch (e) {
            if (callback) {
                callback(e instanceof Error ? e : new Error(e.toString()));
            }
        }
    }

    private dispatch(messages: IMessage|IMessage[], res: IWebResponse) {
        // Dispatch messages/activities
        var list: IMessage[] = Array.isArray(messages) ? messages : [messages];
        list.forEach((msg) => {
            try {
                // Break out address fields
                var address = <IChatConnectorAddress>{};
                utils.moveFieldsTo(msg, address, <any>toAddress);
                msg.address = address;
                msg.source = address.channelId;

                // Patch serviceUrl
                logger.info(address, 'ChatConnector: message received.');
                if (address.serviceUrl) {
                    try {
                        var u = url.parse(address.serviceUrl);
                        address.serviceUrl = u.protocol + '//' + u.host;
                    } catch (e) {
                        console.error("ChatConnector error parsing '" + address.serviceUrl + "': " + e.toString());
                    }
                }

                // Patch locale and channelData
                utils.moveFieldsTo(msg, msg, { 
                    'locale': 'textLocale',
                    'channelData': 'sourceEvent'
                });

                // Ensure basic fields are there
                msg.text = msg.text || '';
                msg.attachments = msg.attachments || [];
                msg.entities = msg.entities || [];

                // Dispatch message
                this.handler([msg]);
            } catch (e) {
                console.error(e.toString());
            }
        });

        // Acknowledge that we recieved the message(s)
        res.status(202);
        res.end();
    }

    private postMessage(msg: IMessage, cb: (err: Error) => void): void {
        // Apply address fields
        var address = <IChatConnectorAddress>msg.address;
        (<any>msg)['from'] = address.bot;
        (<any>msg)['recipient'] = address.user; 
        delete msg.address;

        // Patch message fields
        utils.moveFieldsTo(msg, msg, {
            'textLocale': 'locale',
            'sourceEvent': 'channelData'
        });
        delete msg.agent;
        delete msg.source;

        // Calculate path
        var path = '/v3/conversations/' + encodeURIComponent(address.conversation.id) + '/activities';
        if (address.id && address.channelId !== 'skype') {
            path += '/' + encodeURIComponent(address.id);
        }
        
        // Issue request
        logger.info(address, 'ChatConnector: sending message.')
        var options: request.Options = {
            method: 'POST',
            url: url.resolve(address.serviceUrl, path),
            body: msg,
            json: true
        };
        if (address.useAuth) {
            this.authenticatedRequest(options, (err, response, body) => cb(err));
        } else {
            request(options, (err, response, body) => {
                if (!err && response.statusCode >= 400) {
                    var txt = "Request to '" + options.url + "' failed: [" + response.statusCode + "] " + response.statusMessage;
                    err = new Error(txt);
                }
                cb(err);
            });
        }
    }

    private authenticatedRequest(options: request.Options, callback: (error: any, response: http.IncomingMessage, body: any) => void, refresh = false): void {
        if (refresh) {
            this.accessToken = null;
        }
        this.addAccessToken(options, (err) => {
            if (!err) {
                request(options, (err, response, body) => {
                    if (!err) {
                        switch (response.statusCode) {
                            case 401:
                            case 403:
                                if (!refresh) {
                                    this.authenticatedRequest(options, callback, true);
                                } else {
                                    callback(null, response, body);
                                }
                                break;
                            default:
                                if (response.statusCode < 400) {
                                    callback(null, response, body);
                                } else {
                                    var txt = "Request to '" + options.url + "' failed: [" + response.statusCode + "] " + response.statusMessage;
                                    callback(new Error(txt), response, null);
                                }
                                break;
                        }
                    } else {
                        callback(err, null, null);
                    }
                });
            } else {
                callback(err, null, null);
            }
        });
    }

    public getAccessToken(cb: (err: Error, accessToken: string) => void): void {
        if (!this.accessToken || new Date().getTime() >= this.accessTokenExpires) {
            // Refresh access token
            var opt: request.Options = {
                method: 'POST',
                url: this.settings.endpoint.refreshEndpoint,
                form: {
                    grant_type: 'client_credentials',
                    client_id: this.settings.appId,
                    client_secret: this.settings.appPassword,
                    scope: this.settings.endpoint.refreshScope
                }
            };
            request(opt, (err, response, body) => {
                if (!err) {
                    if (body && response.statusCode < 300) {
                        // Subtract 5 minutes from expires_in so they'll we'll get a
                        // new token before it expires.
                        var oauthResponse = JSON.parse(body);
                        this.accessToken = oauthResponse.access_token;
                        this.accessTokenExpires = new Date().getTime() + ((oauthResponse.expires_in - 300) * 1000); 
                        cb(null, this.accessToken);
                    } else {
                        cb(new Error('Refresh access token failed with status code: ' + response.statusCode), null);
                    }
                } else {
                    cb(err, null);
                }
            });
        } else {
            cb(null, this.accessToken);
        }
    }

    private addAccessToken(options: request.Options, cb: (err: Error) => void): void {
        if (this.settings.appId && this.settings.appPassword) {
            this.getAccessToken((err, token) => {
                if (!err && token) {
                    options.headers = {
                        'Authorization': 'Bearer ' + token
                    };
                    cb(null);
                } else {
                    cb(err);
                }
            });
        } else {
            cb(null);
        }
    }

    private getStoragePath(address: IChatConnectorAddress): string {
        // Calculate host
        var path: string;
        switch (address.channelId) {
            case 'emulator':
            //case 'skype-teams':
                if (address.serviceUrl) {
                    path = address.serviceUrl;
                } else {
                    throw new Error('ChatConnector.getStoragePath() missing address.serviceUrl.');
                }
                break;
            default:
                path = this.settings.endpoint.stateEndpoint;
                break;
        }

        // Append base path info.
        return path + '/v3/botstate/' + encodeURIComponent(address.channelId);
    }
}

var toAddress = {
    'id': 'id',
    'channelId': 'channelId',
    'from': 'user',
    'conversation': 'conversation',
    'recipient': 'bot',
    'serviceUrl': 'serviceUrl',
    'useAuth': 'useAuth'
}

interface IChatConnectorStorageData extends bs.IBotStorageData {
    userDataHash?: string;
    conversationDataHash?: string;
    privateConversationDataHash?: string;
}

interface IChatConnectorState {
    eTag: string;
    data?: any;
}

/** Express or Restify Request object. */
interface IWebRequest {
    body: any;
    headers: {
        [name: string]: string;
    };
    on(event: string, ...args: any[]): void;
}

/** Express or Restify Response object. */
interface IWebResponse {
    end(): this;
    send(status: number, body?: any): this;
    send(body: any): this;
    status(code: number): this;
}

/** Express or Restify Middleware Function. */
interface IWebMiddleware {
    (req: IWebRequest, res: IWebResponse, next?: Function): void;
}

interface IOpenIdConfig {
  issuer: string;
  authorization_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

interface IKey {
      kty: string;
      use: string;
      kid: string;
      x5t: string;
      n: string;
      e: string;
      x5c: string[];
}
