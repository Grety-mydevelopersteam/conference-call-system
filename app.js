// Conference Call & Recording System
// Business conference calling solution with recording and transcription
// Author: Your Name
// Version: 1.5.0

const express = require('express');
const twilio = require('twilio');
const { VoiceResponse } = twilio.twiml;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

// Express setup
const app = express();
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/conference-system', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Twilio client
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Schemas
const ConferenceSchema = new mongoose.Schema({
    conferenceId: { type: String, unique: true, required: true },
    title: { type: String, required: true },
    hostPin: { type: String, required: true },
    participantPin: { type: String, required: true },
    scheduledTime: Date,
    duration: { type: Number, default: 60 }, // minutes
    maxParticipants: { type: Number, default: 10 },
    recordingEnabled: { type: Boolean, default: true },
    transcriptionEnabled: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['scheduled', 'active', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    participants: [{
        phone: String,
        name: String,
        joinTime: Date,
        leaveTime: Date,
        role: { type: String, enum: ['host', 'participant', 'guest'] }
    }],
    recordings: [{
        recordingSid: String,
        url: String,
        duration: Number,
        createdAt: Date
    }],
    transcriptions: [{
        text: String,
        confidence: Number,
        createdAt: Date
    }],
    createdBy: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const ParticipantSchema = new mongoose.Schema({
    callSid: { type: String, unique: true },
    conferenceId: String,
    phoneNumber: String,
    participantName: String,
    role: String,
    joinTime: Date,
    muteStatus: { type: Boolean, default: false },
    holdStatus: { type: Boolean, default: false },
    speakingTime: { type: Number, default: 0 }, // seconds
    lastActivity: Date
});

const CallLogSchema = new mongoose.Schema({
    callSid: String,
    from: String,
    to: String,
    conferenceId: String,
    duration: Number,
    status: String,
    direction: String,
    cost: Number,
    recordingUrl: String,
    timestamp: { type: Date, default: Date.now }
});

// Models
const Conference = mongoose.model('Conference', ConferenceSchema);
const Participant = mongoose.model('Participant', ParticipantSchema);
const CallLog = mongoose.model('CallLog', CallLogSchema);

// Active conferences tracker
const activeConferences = new Map();

// Main conference entry point
app.post('/conference/join', async (req, res) => {
    const twiml = new VoiceResponse();
    const { CallSid, From } = req.body;
    
    try {
        // Welcome message
        twiml.say({
            voice: 'Polly.Matthew',
            language: 'en-US'
        }, 'Welcome to the conference calling system.');
        
        // Gather conference ID
        const gather = twiml.gather({
            numDigits: 6,
            action: '/conference/verify-pin',
            method: 'POST',
            timeout: 10,
            finishOnKey: '#'
        });
        
        gather.say({
            voice: 'Polly.Matthew'
        }, 'Please enter your 6-digit conference PIN followed by the pound key.');
        
        // No input received
        twiml.say('We did not receive your PIN.');
        twiml.redirect('/conference/join');
        
        // Log call
        await logIncomingCall(CallSid, From);
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('Conference Join Error:', error);
        handleConferenceError(twiml, res);
    }
});

// Verify PIN and determine role
app.post('/conference/verify-pin', async (req, res) => {
    const { Digits, CallSid, From } = req.body;
    const twiml = new VoiceResponse();
    
    try {
        // Find conference by PIN
        const conference = await Conference.findOne({
            $or: [
                { hostPin: Digits },
                { participantPin: Digits }
            ],
            status: { $in: ['scheduled', 'active'] }
        });
        
        if (!conference) {
            twiml.say({
                voice: 'Polly.Matthew'
            }, 'Invalid conference PIN. Please try again.');
            twiml.redirect('/conference/join');
            
            res.type('text/xml');
            res.send(twiml.toString());
            return;
        }
        
        // Determine role
        const isHost = conference.hostPin === Digits;
        const role = isHost ? 'host' : 'participant';
        
        // Check participant limit
        if (!isHost && conference.participants.length >= conference.maxParticipants) {
            twiml.say({
                voice: 'Polly.Matthew'
            }, 'This conference has reached its maximum capacity. Please try again later.');
            twiml.hangup();
            
            res.type('text/xml');
            res.send(twiml.toString());
            return;
        }
        
        // Get participant name
        const gather = twiml.gather({
            input: 'speech',
            action: `/conference/enter/${conference.conferenceId}?role=${role}`,
            method: 'POST',
            timeout: 3,
            speechTimeout: 2,
            language: 'en-US'
        });
        
        gather.say({
            voice: 'Polly.Matthew'
        }, 'Please say your name, then press any key.');
        
        // If no name provided, enter with phone number
        twiml.redirect(`/conference/enter/${conference.conferenceId}?role=${role}&name=Guest`);
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('PIN Verification Error:', error);
        handleConferenceError(twiml, res);
    }
});

// Enter conference room
app.post('/conference/enter/:conferenceId', async (req, res) => {
    const { conferenceId } = req.params;
    const { CallSid, From, SpeechResult } = req.body;
    const { role, name } = req.query;
    const twiml = new VoiceResponse();
    
    try {
        const conference = await Conference.findOne({ conferenceId });
        
        if (!conference) {
            twiml.say('Conference not found.');
            twiml.hangup();
            res.type('text/xml');
            res.send(twiml.toString());
            return;
        }
        
        // Update conference status
        if (conference.status === 'scheduled') {
            conference.status = 'active';
            await conference.save();
        }
        
        const participantName = SpeechResult || name || 'Guest';
        
        // Add participant to database
        const participant = new Participant({
            callSid: CallSid,
            conferenceId: conferenceId,
            phoneNumber: From,
            participantName: participantName,
            role: role,
            joinTime: new Date()
        });
        await participant.save();
        
        // Update conference participants
        conference.participants.push({
            phone: From,
            name: participantName,
            joinTime: new Date(),
            role: role
        });
        await conference.save();
        
        // Announce entry
        twiml.say({
            voice: 'Polly.Matthew'
        }, `${participantName} is joining the conference.`);
        
        // Conference options based on role
        const dial = twiml.dial({
            action: `/conference/leave/${conferenceId}`,
            method: 'POST',
            hangupOnStar: true,
            timeLimit: conference.duration * 60 // Convert to seconds
        });
        
        const conferenceOptions = {
            beep: true,
            startConferenceOnEnter: role === 'host',
            endConferenceOnExit: role === 'host',
            waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
            maxParticipants: conference.maxParticipants,
            record: conference.recordingEnabled ? 'record-from-start' : 'do-not-record',
            trim: 'trim-silence',
            statusCallback: `/conference/events/${conferenceId}`,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: 'start end join leave mute hold speaker'
        };
        
        if (role === 'host') {
            conferenceOptions.muted = false;
        } else {
            conferenceOptions.muted = false; // Can be changed to true for large conferences
        }
        
        dial.conference(conferenceOptions, `conference-${conferenceId}`);
        
        res.type('text/xml');
        res.send(twiml.toString());
        
        // Store active conference
        if (!activeConferences.has(conferenceId)) {
            activeConferences.set(conferenceId, {
                startTime: new Date(),
                participants: new Map()
            });
        }
        activeConferences.get(conferenceId).participants.set(CallSid, {
            name: participantName,
            role: role,
            joinTime: new Date()
        });
        
    } catch (error) {
        console.error('Conference Enter Error:', error);
        handleConferenceError(twiml, res);
    }
});

// Conference events handler
app.post('/conference/events/:conferenceId', async (req, res) => {
    const { conferenceId } = req.params;
    const { StatusCallbackEvent, CallSid, Muted, Hold } = req.body;
    
    try {
        console.log(`Conference ${conferenceId} Event: ${StatusCallbackEvent}`);
        
        switch (StatusCallbackEvent) {
            case 'conference-start':
                await handleConferenceStart(conferenceId);
                break;
            case 'conference-end':
                await handleConferenceEnd(conferenceId);
                break;
            case 'participant-join':
                await handleParticipantJoin(conferenceId, CallSid);
                break;
            case 'participant-leave':
                await handleParticipantLeave(conferenceId, CallSid);
                break;
            case 'participant-mute':
                await updateParticipantStatus(CallSid, { muteStatus: Muted === 'true' });
                break;
            case 'participant-hold':
                await updateParticipantStatus(CallSid, { holdStatus: Hold === 'true' });
                break;
        }
        
        res.status(200).send('OK');
        
    } catch (error) {
        console.error('Conference Event Error:', error);
        res.status(500).send('Error');
    }
});

// Leave conference
app.post('/conference/leave/:conferenceId', async (req, res) => {
    const { conferenceId } = req.params;
    const { CallSid, CallDuration } = req.body;
    const twiml = new VoiceResponse();
    
    try {
        // Update participant leave time
        const participant = await Participant.findOne({ callSid: CallSid });
        if (participant) {
            participant.leaveTime = new Date();
            await participant.save();
        }
        
        // Update conference participant
        const conference = await Conference.findOne({ conferenceId });
        if (conference) {
            const participantIndex = conference.participants.findIndex(p => 
                p.phone === participant.phoneNumber && !p.leaveTime
            );
            if (participantIndex !== -1) {
                conference.participants[participantIndex].leaveTime = new Date();
                await conference.save();
            }
        }
        
        // Log call
        await CallLog.create({
            callSid: CallSid,
            conferenceId: conferenceId,
            duration: CallDuration,
            status: 'completed'
        });
        
        twiml.say({
            voice: 'Polly.Matthew'
        }, 'Thank you for using our conference service. Goodbye.');
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        
    } catch (error) {
        console.error('Leave Conference Error:', error);
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Create scheduled conference
app.post('/api/conferences/create', async (req, res) => {
    try {
        const {
            title,
            scheduledTime,
            duration,
            maxParticipants,
            recordingEnabled,
            transcriptionEnabled,
            createdBy
        } = req.body;
        
        // Generate unique PINs
        const hostPin = generatePin();
        const participantPin = generatePin();
        const conferenceId = uuidv4().substring(0, 8);
        
        const conference = new Conference({
            conferenceId,
            title,
            hostPin,
            participantPin,
            scheduledTime: new Date(scheduledTime),
            duration: duration || 60,
            maxParticipants: maxParticipants || 10,
            recordingEnabled: recordingEnabled !== false,
            transcriptionEnabled: transcriptionEnabled || false,
            createdBy
        });
        
        await conference.save();
        
        // Schedule reminder calls
        if (scheduledTime) {
            scheduleReminderCalls(conference);
        }
        
        res.json({
            success: true,
            conference: {
                conferenceId: conference.conferenceId,
                title: conference.title,
                hostPin: conference.hostPin,
                participantPin: conference.participantPin,
                scheduledTime: conference.scheduledTime,
                dialInNumber: process.env.TWILIO_PHONE_NUMBER
            }
        });
        
    } catch (error) {
        console.error('Create Conference Error:', error);
        res.status(500).json({ error: 'Failed to create conference' });
    }
});

// Get conference details
app.get('/api/conferences/:conferenceId', async (req, res) => {
    try {
        const { conferenceId } = req.params;
        const conference = await Conference.findOne({ conferenceId });
        
        if (!conference) {
            return res.status(404).json({ error: 'Conference not found' });
        }
        
        // Get live participants if active
        let liveParticipants = [];
        if (conference.status === 'active') {
            liveParticipants = await Participant.find({
                conferenceId,
                leaveTime: null
            });
        }
        
        res.json({
            conference,
            liveParticipants,
            isActive: conference.status === 'active'
        });
        
    } catch (error) {
        console.error('Get Conference Error:', error);
        res.status(500).json({ error: 'Failed to get conference details' });
    }
});

// Moderator controls
app.post('/api/conferences/:conferenceId/moderate', async (req, res) => {
    try {
        const { conferenceId } = req.params;
        const { action, participantCallSid } = req.body;
        
        const conferenceSid = `conference-${conferenceId}`;
        
        switch (action) {
            case 'mute':
                await twilioClient.conferences(conferenceSid)
                    .participants(participantCallSid)
                    .update({ muted: true });
                break;
                
            case 'unmute':
                await twilioClient.conferences(conferenceSid)
                    .participants(participantCallSid)
                    .update({ muted: false });
                break;
                
            case 'hold':
                await twilioClient.conferences(conferenceSid)
                    .participants(participantCallSid)
                    .update({ hold: true });
                break;
                
            case 'unhold':
                await twilioClient.conferences(conferenceSid)
                    .participants(participantCallSid)
                    .update({ hold: false });
                break;
                
            case 'kick':
                await twilioClient.conferences(conferenceSid)
                    .participants(participantCallSid)
                    .remove();
                break;
                
            case 'end':
                await twilioClient.conferences(conferenceSid)
                    .update({ status: 'completed' });
                break;
        }
        
        res.json({ success: true, action: action });
        
    } catch (error) {
        console.error('Moderate Conference Error:', error);
        res.status(500).json({ error: 'Failed to moderate conference' });
    }
});

// Get conference recordings
app.get('/api/conferences/:conferenceId/recordings', async (req, res) => {
    try {
        const { conferenceId } = req.params;
        const conference = await Conference.findOne({ conferenceId });
        
        if (!conference) {
            return res.status(404).json({ error: 'Conference not found' });
        }
        
        // Fetch recordings from Twilio
        const recordings = await twilioClient.recordings
            .list({ 
                conferenceSid: `conference-${conferenceId}`,
                limit: 20 
            });
        
        const recordingData = recordings.map(rec => ({
            sid: rec.sid,
            duration: rec.duration,
            url: `https://api.twilio.com${rec.uri.replace('.json', '.mp3')}`,
            dateCreated: rec.dateCreated
        }));
        
        res.json({
            conferenceId,
            recordings: recordingData
        });
        
    } catch (error) {
        console.error('Get Recordings Error:', error);
        res.status(500).json({ error: 'Failed to get recordings' });
    }
});

// Download recording
app.get('/api/recordings/:recordingSid/download', async (req, res) => {
    try {
        const { recordingSid } = req.params;
        
        const recording = await twilioClient.recordings(recordingSid).fetch();
        const recordingUrl = `https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`;
        
        res.redirect(recordingUrl);
        
    } catch (error) {
        console.error('Download Recording Error:', error);
        res.status(500).json({ error: 'Failed to download recording' });
    }
});

// Analytics endpoint
app.get('/api/analytics/conferences', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        const query = {};
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }
        
        const conferences = await Conference.find(query);
        
        const analytics = {
            totalConferences: conferences.length,
            completedConferences: conferences.filter(c => c.status === 'completed').length,
            totalParticipants: conferences.reduce((sum, c) => sum + c.participants.length, 0),
            averageParticipants: conferences.length > 0 
                ? conferences.reduce((sum, c) => sum + c.participants.length, 0) / conferences.length 
                : 0,
            totalRecordings: conferences.reduce((sum, c) => sum + c.recordings.length, 0),
            averageDuration: conferences.filter(c => c.status === 'completed').reduce((sum, c) => {
                const duration = c.participants.reduce((max, p) => {
                    if (p.leaveTime && p.joinTime) {
                        const dur = (p.leaveTime - p.joinTime) / 1000 / 60; // minutes
                        return Math.max(max, dur);
                    }
                    return max;
                }, 0);
                return sum + duration;
            }, 0) / conferences.filter(c => c.status === 'completed').length || 0
        };
        
        res.json(analytics);
        
    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

// Helper functions
function generatePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function handleConferenceStart(conferenceId) {
    const conference = await Conference.findOne({ conferenceId });
    if (conference) {
        conference.status = 'active';
        await conference.save();
    }
}

async function handleConferenceEnd(conferenceId) {
    const conference = await Conference.findOne({ conferenceId });
    if (conference) {
        conference.status = 'completed';
        conference.updatedAt = new Date();
        await conference.save();
    }
    
    // Clean up active conference
    activeConferences.delete(conferenceId);
}

async function handleParticipantJoin(conferenceId, callSid) {
    await Participant.findOneAndUpdate(
        { callSid },
        { lastActivity: new Date() }
    );
}

async function handleParticipantLeave(conferenceId, callSid) {
    const participant = await Participant.findOne({ callSid });
    if (participant && !participant.leaveTime) {
        participant.leaveTime = new Date();
        await participant.save();
    }
}

async function updateParticipantStatus(callSid, updates) {
    await Participant.findOneAndUpdate(
        { callSid },
        { ...updates, lastActivity: new Date() }
    );
}

async function logIncomingCall(callSid, from) {
    await CallLog.create({
        callSid,
        from,
        to: process.env.TWILIO_PHONE_NUMBER,
        direction: 'inbound',
        status: 'in-progress',
        timestamp: new Date()
    });
}

function scheduleReminderCalls(conference) {
    const reminderTime = moment(conference.scheduledTime).subtract(15, 'minutes');
    
    if (reminderTime.isAfter(moment())) {
        const cronTime = `${reminderTime.minutes()} ${reminderTime.hours()} ${reminderTime.date()} ${reminderTime.month() + 1} *`;
        
        cron.schedule(cronTime, async () => {
            console.log(`Sending reminders for conference ${conference.conferenceId}`);
            // Implementation for reminder calls
        });
    }
}

function handleConferenceError(twiml, res) {
    twiml.say({
        voice: 'Polly.Matthew'
    }, 'We apologize for the technical difficulty. Please try again later.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
}

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'operational',
        service: 'Conference Call System',
        version: '1.5.0',
        activeConferences: activeConferences.size
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Conference System running on port ${PORT}`);
    console.log(`Dial-in number: ${process.env.TWILIO_PHONE_NUMBER}`);
});
