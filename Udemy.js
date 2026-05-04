const puppeteer = require('puppeteer');
const https     = require('https');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const COOKIE_FILE    = 'C:\\Users\\Jilin James\\Pictures\\uden\\udemy_cookies.txt';
const OUTPUT_DIR     = 'C:\\Users\\Jilin James\\Pictures\\uden';
const INTERVAL_MS    = 4 * 60 * 60 * 1000;
const DASHBOARD_PORT = 3456;

// ── IFTTT CONFIG ──────────────────────────────────────────────────────────────
const IFTTT_WEBHOOK_KEY      = 'nbnaRA9jPjQrVmi74lB7oyFS-HBhoZKB5GnUkntNeSE';
const IFTTT_FB_EVENT         = 'udemy_free_course';
const IFTTT_REDDIT_EVENT     = 'udemy_free_reddit';
const IFTTT_LINKEDIN_EVENT   = 'udemy_free_linkedin';
const IFTTT_TELEGRAM_EVENT   = 'udemy_free_telegram';
const IFTTT_TUMBLR_EVENT     = 'udemy_free_tumblr';
const IFTTT_WORDPRESS_EVENT  = 'udemy_free_wordpress';

// ── TWITTER / X DIRECT API CONFIG ────────────────────────────────────────────
const TWITTER_API_KEY             = 'YGXR2O7Gz8Zxw9T3AH4HUx3pd';
const TWITTER_API_SECRET          = 'h76ZJ1NgsOkVvu1o6kwb2bivzZeA0Ezstm2sowVpEKVTmuGIoL';
const TWITTER_ACCESS_TOKEN        = '815886085448351744-bw2rvIMZpyBcW7ZwtHBXTJvB3wggnTM';
const TWITTER_ACCESS_TOKEN_SECRET = 'zhh6zHWwvtEzjvvN4dbYJkop9irv1oRljzxLdQEQdXeZs';

// ── PLATFORM TOGGLES ─────────────────────────────────────────────────────────
const POST_TO_FACEBOOK  = true;
const POST_TO_REDDIT    = true;
const POST_TO_LINKEDIN  = true;
const POST_TO_TELEGRAM  = true;
const POST_TO_TUMBLR    = true;
const POST_TO_WORDPRESS = true;
const POST_TO_TWITTER   = true;

// ── CHAR LIMITS ───────────────────────────────────────────────────────────────
const LINKEDIN_CHAR_LIMIT  = 2500;
const TELEGRAM_CHAR_LIMIT  = 3800;
const TUMBLR_CHAR_LIMIT    = 4096;
const WORDPRESS_CHAR_LIMIT = 10000;
const TWITTER_LONG_LIMIT   = 24500;
const TWITTER_SHORT_LIMIT  = 265;

const REDDIT_SUBREDDIT = 'FreeUdemyCourses';

const NL  = '\r\n';
const NL2 = '\r\n\r\n';

// ── DETECT NON-ENGLISH ────────────────────────────────────────────────────────
function isNonEnglish(title) {
    if (/[\u0400-\u04FF]/.test(title)) return true;
    if (/[\u0600-\u06FF\u0590-\u05FF]/.test(title)) return true;
    if (/[\u3000-\u9FFF\uAC00-\uD7AF]/.test(title)) return true;
    if (/[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(title)) return true;
    if (/[\u0900-\u097F\u0E00-\u0E7F]/.test(title)) return true;
    return false;
}

function sortEnglishFirst(courses) {
    const english    = courses.filter(c => !isNonEnglish(c.title));
    const nonEnglish = courses.filter(c =>  isNonEnglish(c.title));
    return [...english, ...nonEnglish];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getIST(date = new Date()) {
    return new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
}
function getDateRange() {
    const now48hAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    return {
        from: getIST(now48hAgo).toISOString().slice(0, 10),
        to:   getIST().toISOString().slice(0, 10)
    };
}

let state = {
    running:      false,
    lastRun:      null,
    nextRun:      null,
    dateFrom:     null,
    dateTo:       null,
    totalFound:   0,
    progress:     0,
    currentTitle: '',
    freeCourses:  [],
    log:          [],
    posts:        [],
    lastError:    null
};

function log(msg) {
    const ts   = new Date().toLocaleTimeString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    state.log.unshift(line);
    if (state.log.length > 200) state.log.length = 200;
}

// ── Message builders ──────────────────────────────────────────────────────────
const FOOTER_PLAIN = NL2 + '#Udemy #FreeCourses #LearnForFree #OnlineLearning';

function buildHeader(totalCount, partNum, totalParts) {
    const today = getIST().toISOString().slice(0, 10);
    const part  = totalParts > 1 ? ` (Part ${partNum}/${totalParts})` : '';
    return `🎓 ${totalCount} FREE Udemy Courses - ${today}${part}`;
}

function buildFBMessage(courses) {
    const today  = getIST().toISOString().slice(0, 10);
    const sorted = sortEnglishFirst(courses);
    const header = `🎓 ${courses.length} FREE Udemy Courses - ${today}`;
    const body   = sorted.map((c, i) => `${i + 1}. ${c.title}${NL}${c.freewebcartUrl}`).join(NL2);
    return header + NL2 + body + FOOTER_PLAIN;
}

function buildRedditMessage(courses) {
    const today  = getIST().toISOString().slice(0, 10);
    const sorted = sortEnglishFirst(courses);
    const body   = sorted.map((c, i) => `${i + 1}. ${c.title}\r\n${c.freewebcartUrl}`).join('\r\n\r\n');
    return `🎓 ${courses.length} FREE Udemy Courses - ${today}\r\n\r\n` + body
         + `\r\n\r\n#Udemy #FreeCourses #LearnForFree #OnlineLearning`;
}

function buildTitle(courses) {
    return `🎓 ${courses.length} FREE Udemy Courses - ${getIST().toISOString().slice(0, 10)}`;
}

function buildTumblrHtmlChunks(courses, charLimit) {
    const sorted  = sortEnglishFirst(courses);
    const total   = courses.length;
    const RESERVE = 400;
    const groups  = [];
    let i = 0;
    while (i < sorted.length) {
        const group  = [];
        let   budget = charLimit - RESERVE;
        while (i < sorted.length) {
            const line = `<p><strong>${i + 1}. ${sorted[i].title}</strong><br><a href="${sorted[i].freewebcartUrl}" target="_blank">${sorted[i].freewebcartUrl}</a></p>`;
            if (line.length > budget && group.length > 0) break;
            group.push({ course: sorted[i], line });
            i++;
            budget -= line.length;
        }
        groups.push(group);
    }
    const totalParts = groups.length;
    return groups.map((group, ci) => {
        const today = getIST().toISOString().slice(0, 10);
        const part  = totalParts > 1 ? ` (Part ${ci + 1}/${totalParts})` : '';
        const rows  = group.map(g => g.line).join('\n');
        const html  = `<h2>🎓 ${total} FREE Udemy Courses — ${today}${part}</h2>\n${rows}\n<p><em>#Udemy #FreeCourses #LearnForFree #OnlineLearning</em></p>`;
        log(`  Tumblr chunk ${ci + 1}/${totalParts}: ${group.length} courses, ${html.length} chars`);
        return { html, count: group.length };
    });
}

function buildSplitChunks(courses, charLimit) {
    const sorted = sortEnglishFirst(courses);
    const total  = courses.length;
    const lines  = sorted.map((c, i) => `${i + 1}. ${c.title}${NL}${c.freewebcartUrl}`);
    const RESERVE = 130;
    const groups  = [];
    let i = 0;
    while (i < lines.length) {
        const group  = [];
        let   budget = charLimit - RESERVE;
        while (i < lines.length) {
            const cost = lines[i].length + (group.length > 0 ? NL2.length : 0);
            if (cost > budget) { if (group.length === 0) { group.push(lines[i++]); } break; }
            group.push(lines[i++]);
            budget -= cost;
        }
        groups.push(group);
    }
    const totalParts = groups.length;
    return groups.map((group, ci) => {
        const copy = [...group];
        let   text = buildHeader(total, ci + 1, totalParts) + NL2 + copy.join(NL2) + FOOTER_PLAIN;
        while (text.length > charLimit && copy.length > 1) {
            copy.pop();
            text = buildHeader(total, ci + 1, totalParts) + NL2 + copy.join(NL2) + FOOTER_PLAIN;
        }
        log(`  chunk ${ci + 1}/${totalParts}: ${copy.length} courses, ${text.length} chars`);
        return text;
    });
}

function buildSplitChunksWordPress(courses, charLimit) {
    const sorted  = sortEnglishFirst(courses);
    const total   = courses.length;
    const RESERVE = 300;
    const groups  = [];
    let i = 0;
    while (i < sorted.length) {
        const group  = [];
        let   budget = charLimit - RESERVE;
        while (i < sorted.length) {
            const line = `<li><strong>${i + 1}. ${sorted[i].title}</strong><br><a href="${sorted[i].freewebcartUrl}">${sorted[i].freewebcartUrl}</a></li>`;
            const cost = line.length + 2;
            if (cost > budget && group.length > 0) break;
            group.push({ course: sorted[i], line });
            i++;
            budget -= cost;
        }
        groups.push(group);
    }
    const totalParts = groups.length;
    return groups.map((group, ci) => {
        const today = getIST().toISOString().slice(0, 10);
        const part  = totalParts > 1 ? ` (Part ${ci + 1}/${totalParts})` : '';
        const rows  = group.map(g => g.line).join('\n');
        const body  = `<p>Here are <strong>${total} FREE Udemy courses</strong> available today (${today})${part}!</p>\n<ol>\n${rows}\n</ol>\n<p><em>Grab them before the coupons expire!</em></p>\n<p>#Udemy #FreeCourses #LearnForFree #OnlineLearning</p>`;
        log(`  WordPress chunk ${ci + 1}/${totalParts}: ${group.length} courses, ${body.length} chars`);
        return { body, count: group.length };
    });
}

// ── Send one IFTTT webhook ────────────────────────────────────────────────────
function sendIFTTT(eventName, value1, value2 = '', value3 = '') {
    return new Promise((resolve) => {
        const body = JSON.stringify({ value1, value2, value3 });
        const opts = {
            hostname: 'maker.ifttt.com',
            path:     `/trigger/${eventName}/with/key/${IFTTT_WEBHOOK_KEY}`,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: data }));
        });
        req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
        req.setTimeout(12000, () => { req.destroy(); resolve({ ok: false, status: 0, body: 'Timeout' }); });
        req.write(body);
        req.end();
    });
}

function recordPost(platform, courses, chars, part, totalParts, error) {
    const preview = courses[0].title.substring(0, 45) + (courses.length > 1 ? ` +${courses.length - 1} more` : '');
    state.posts.unshift({ time: new Date().toLocaleTimeString(), platform, count: courses.length, chars, part, totalParts, preview, error: error || null });
    if (state.posts.length > 80) state.posts.length = 80;
}

async function sendWithRetry(eventName, v1, v2 = '', v3 = '') {
    let result, attempt = 0;
    do {
        if (attempt > 0) { log(`  Retrying (attempt ${attempt + 1})...`); await sleep(10000); }
        result = await sendIFTTT(eventName, v1, v2, v3);
        attempt++;
    } while (!result.ok && attempt < 3);
    return result;
}

async function postFacebook(courses) {
    const message = buildFBMessage(courses);
    log(`📘 Facebook: ${courses.length} courses, ${message.length} chars → 1 call`);
    const result = await sendWithRetry(IFTTT_FB_EVENT, message);
    if (result.ok) { log(`  ✅ Facebook sent!`); state.lastError = null; recordPost('facebook', courses, message.length, 1, 1, null); }
    else { const err = `HTTP ${result.status}: ${result.body.substring(0, 80)}`; log(`  ❌ Facebook: ${err}`); state.lastError = err; recordPost('facebook', courses, message.length, 1, 1, err); }
}

async function postReddit(courses) {
    const message = buildRedditMessage(courses);
    const title   = buildTitle(courses);
    log(`🟠 Reddit: ${courses.length} courses, ${message.length} chars → 1 call`);
    const result = await sendWithRetry(IFTTT_REDDIT_EVENT, message, title);
    if (result.ok) { log(`  ✅ Reddit sent!`); state.lastError = null; recordPost('reddit', courses, message.length, 1, 1, null); }
    else { const err = `HTTP ${result.status}: ${result.body.substring(0, 80)}`; log(`  ❌ Reddit: ${err}`); state.lastError = err; recordPost('reddit', courses, message.length, 1, 1, err); }
}

async function postLinkedIn(courses) {
    const chunks = buildSplitChunks(courses, LINKEDIN_CHAR_LIMIT);
    log(`💼 LinkedIn: ${courses.length} courses → ${chunks.length} chunk(s)`);
    for (let i = 0; i < chunks.length; i++) {
        const result = await sendWithRetry(IFTTT_LINKEDIN_EVENT, chunks[i]);
        if (result.ok) { log(`  ✅ LinkedIn part ${i+1}/${chunks.length} sent!`); state.lastError = null; recordPost('linkedin', courses, chunks[i].length, i+1, chunks.length, null); }
        else { const err = `HTTP ${result.status}: ${result.body.substring(0, 80)}`; log(`  ❌ LinkedIn part ${i+1}: ${err}`); state.lastError = err; recordPost('linkedin', courses, chunks[i].length, i+1, chunks.length, err); }
        if (i < chunks.length - 1) { log(`  ⏳ Waiting 60s...`); await sleep(60000); }
    }
}

async function postTelegram(courses) {
    const chunks = buildSplitChunks(courses, TELEGRAM_CHAR_LIMIT);
    log(`✈️ Telegram: ${courses.length} courses → ${chunks.length} chunk(s)`);
    for (let i = 0; i < chunks.length; i++) {
        const result = await sendWithRetry(IFTTT_TELEGRAM_EVENT, chunks[i]);
        if (result.ok) { log(`  ✅ Telegram part ${i+1}/${chunks.length} sent!`); state.lastError = null; recordPost('telegram', courses, chunks[i].length, i+1, chunks.length, null); }
        else { const err = `HTTP ${result.status}: ${result.body.substring(0, 80)}`; log(`  ❌ Telegram part ${i+1}: ${err}`); state.lastError = err; recordPost('telegram', courses, chunks[i].length, i+1, chunks.length, err); }
        if (i < chunks.length - 1) { log(`  ⏳ Waiting 60s...`); await sleep(60000); }
    }
}

async function postTumblr(courses) {
    const chunks = buildTumblrHtmlChunks(courses, TUMBLR_CHAR_LIMIT);
    log(`📓 Tumblr: ${courses.length} courses → ${chunks.length} HTML chunk(s)`);
    for (let i = 0; i < chunks.length; i++) {
        const { html } = chunks[i];
        const title = buildTitle(courses) + (chunks.length > 1 ? ` (Part ${i+1}/${chunks.length})` : '');
        const result = await sendWithRetry(IFTTT_TUMBLR_EVENT, html, title, 'Udemy,FreeCourses,LearnForFree,OnlineLearning');
        if (result.ok) { log(`  ✅ Tumblr part ${i+1}/${chunks.length} sent!`); state.lastError = null; recordPost('tumblr', courses, html.length, i+1, chunks.length, null); }
        else { const err = `HTTP ${result.status}: ${result.body.substring(0, 80)}`; log(`  ❌ Tumblr part ${i+1}: ${err}`); state.lastError = err; recordPost('tumblr', courses, html.length, i+1, chunks.length, err); }
        if (i < chunks.length - 1) { log(`  ⏳ Waiting 60s...`); await sleep(60000); }
    }
}

async function postWordPress(courses) {
    const chunks = buildSplitChunksWordPress(courses, WORDPRESS_CHAR_LIMIT);
    log(`🌐 WordPress: ${courses.length} courses → ${chunks.length} chunk(s)`);
    for (let i = 0; i < chunks.length; i++) {
        const { body } = chunks[i];
        const title = buildTitle(courses) + (chunks.length > 1 ? ` (Part ${i+1}/${chunks.length})` : '');
        const result = await sendWithRetry(IFTTT_WORDPRESS_EVENT, body, title, 'Udemy,FreeCourses,LearnForFree,OnlineLearning');
        if (result.ok) { log(`  ✅ WordPress part ${i+1}/${chunks.length} sent!`); state.lastError = null; recordPost('wordpress', courses, body.length, i+1, chunks.length, null); }
        else { const err = `HTTP ${result.status}: ${result.body.substring(0, 80)}`; log(`  ❌ WordPress part ${i+1}: ${err}`); state.lastError = err; recordPost('wordpress', courses, body.length, i+1, chunks.length, err); }
        if (i < chunks.length - 1) { log(`  ⏳ Waiting 60s...`); await sleep(60000); }
    }
}

// ── Twitter/X — OAuth 1.0a User Context via .readWrite ───────────────────────
// KEY FIX: must use client.readWrite to force User Context (not App-Only/Bearer)
// Without .readWrite the library defaults to App-Only auth → always 403
const { TwitterApi } = require('twitter-api-v2');

let _rwClient = null;
function getRWClient() {
    if (!_rwClient) {
        const client = new TwitterApi({
            appKey:       TWITTER_API_KEY,       // Consumer Key
            appSecret:    TWITTER_API_SECRET,    // Consumer Secret
            accessToken:  TWITTER_ACCESS_TOKEN,  // Access Token
            accessSecret: TWITTER_ACCESS_TOKEN_SECRET, // Access Token Secret
        });
        _rwClient = client.readWrite; // ← CRITICAL: forces OAuth 1.0a User Context
    }
    return _rwClient;
}

// Build long posts (up to TWITTER_LONG_LIMIT chars) — for Premium accounts
function buildLongPosts(courses) {
    const today   = getIST().toISOString().slice(0, 10);
    const sorted  = sortEnglishFirst(courses);
    const RESERVE = 120;
    const lines   = sorted.map((c, i) => `${i + 1}. ${c.title}\n${c.freewebcartUrl}`);
    const footer  = '\n\n#Udemy #FreeCourses #LearnForFree #OnlineLearning';
    const posts   = [];
    let   group   = [], budget = TWITTER_LONG_LIMIT - RESERVE;
    for (const line of lines) {
        const cost = line.length + (group.length > 0 ? 2 : 0);
        if (cost > budget && group.length > 0) { posts.push(group); group = [line]; budget = TWITTER_LONG_LIMIT - RESERVE - line.length; }
        else { group.push(line); budget -= cost; }
    }
    if (group.length) posts.push(group);
    const total = posts.length;
    return posts.map((g, ci) => {
        const part = total > 1 ? ` (Part ${ci + 1}/${total})` : '';
        return `🎓 ${courses.length} FREE Udemy Courses — ${today}${part}\n\n` + g.join('\n\n') + footer;
    });
}

// Build thread of short tweets (≤ TWITTER_SHORT_LIMIT chars) — free tier fallback
// Splits on course boundaries so each tweet is a complete course entry
function buildThread(courses) {
    const today   = getIST().toISOString().slice(0, 10);
    const sorted  = sortEnglishFirst(courses);
    const header  = `🎓 ${courses.length} FREE Udemy Courses\n${today}\n\n#Udemy #FreeCourses #LearnForFree #OnlineLearning`;
    const batches = [];
    let current = '';
    for (let i = 0; i < sorted.length; i++) {
        const line      = `${i + 1}. ${sorted[i].title}\n${sorted[i].freewebcartUrl}`;
        const candidate = current ? current + '\n\n' + line : line;
        if (candidate.length > TWITTER_SHORT_LIMIT && current) { batches.push(current); current = line; }
        else { current = candidate; }
    }
    if (current) batches.push(current);
    return [header, ...batches];
}

async function postTwitter(courses) {
    const rwClient   = getRWClient();
    const longPosts  = buildLongPosts(courses);
    const totalParts = longPosts.length;
    log(`🐦 Twitter/X: ${courses.length} courses → trying ${totalParts} long post(s) via OAuth 1.0a User Context...`);

    let usedLong = false, replyToId = null;

    // ── Attempt long posts first ──────────────────────────────────────────────
    for (let i = 0; i < longPosts.length; i++) {
        const text = longPosts[i];
        log(`  Long post ${i+1}/${totalParts}: ${text.length} chars...`);
        try {
            const payload = replyToId
                ? { text, reply: { in_reply_to_tweet_id: replyToId } }
                : { text };
            const { data } = await rwClient.v2.tweet(payload);
            replyToId = data.id;
            usedLong  = true;
            log(`  ✅ Long post ${i+1}/${totalParts} sent! https://x.com/i/status/${data.id}`);
            state.lastError = null;
            recordPost('twitter', courses, text.length, i+1, totalParts, null);
        } catch (e) {
            const errBody = e?.data ? JSON.stringify(e.data) : (e?.message || String(e));
            const status  = e?.code || e?.data?.status || 0;
            log(`  ❌ Long post ${i+1} failed (${status}): ${errBody.substring(0, 120)}`);
            console.error('[Twitter long post error]', errBody);
            recordPost('twitter', courses, text.length, i+1, totalParts, `HTTP ${status}: ${errBody.substring(0, 80)}`);
            usedLong = false;
            break;
        }
        if (i < longPosts.length - 1) await sleep(5000);
    }

    if (usedLong) { log(`🐦 Twitter: all long posts sent ✅`); return; }

    // ── Fallb
