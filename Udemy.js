const puppeteer = require('puppeteer');
const https     = require('https');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const COOKIE_FILE = './udemy_cookies.txt';
const OUTPUT_DIR  = './output';
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

    // ── Fallback: thread of short tweets ─────────────────────────────────────
    const tweets = buildThread(courses);
    const tTotal = tweets.length;
    log(`🐦 Twitter fallback: posting thread of ${tTotal} tweets...`);
    replyToId = null;
    let successCount = 0;

    for (let i = 0; i < tweets.length; i++) {
        const text = tweets[i];
        log(`  Thread ${i+1}/${tTotal}: ${text.length} chars...`);
        let lastErr = null, attempt = 0;
        while (attempt < 3) {
            if (attempt > 0) { log(`  Retrying thread tweet ${i+1}...`); await sleep(10000); }
            try {
                const payload = replyToId
                    ? { text, reply: { in_reply_to_tweet_id: replyToId } }
                    : { text };
                const { data } = await rwClient.v2.tweet(payload);
                replyToId = data.id;
                successCount++;
                log(`  ✅ Thread ${i+1}/${tTotal} sent! https://x.com/i/status/${data.id}`);
                state.lastError = null;
                if (i === 0) recordPost('twitter', courses, text.length, 1, tTotal, null);
                lastErr = null;
                break;
            } catch (e) {
                const errBody = e?.data ? JSON.stringify(e.data) : (e?.message || String(e));
                const status  = e?.code || e?.data?.status || 0;
                lastErr = `HTTP ${status}: ${errBody.substring(0, 80)}`;
                console.error(`[Twitter thread ${i+1} error]`, errBody);
            }
            attempt++;
        }
        if (lastErr) {
            log(`  ❌ Thread ${i+1} failed: ${lastErr}`);
            state.lastError = lastErr;
            if (i === 0) recordPost('twitter', courses, text.length, 1, tTotal, lastErr);
        }
        if (i < tweets.length - 1) await sleep(3000);
    }
    log(`🐦 Thread complete: ${successCount}/${tTotal} tweets sent`);
}

async function postAllCourses(courses) {
    if (!courses.length) return;
    if (POST_TO_FACEBOOK)  { await postFacebook(courses);  await sleep(3000); }
    if (POST_TO_REDDIT)    { await postReddit(courses);    await sleep(3000); }
    if (POST_TO_LINKEDIN)  { await postLinkedIn(courses);  await sleep(3000); }
    if (POST_TO_TELEGRAM)  { await postTelegram(courses);  await sleep(3000); }
    if (POST_TO_TUMBLR)    { await postTumblr(courses);    await sleep(3000); }
    if (POST_TO_WORDPRESS) { await postWordPress(courses); await sleep(3000); }
    if (POST_TO_TWITTER)   { await postTwitter(courses);  }
}

// ── Networking — from file 1 (proven working) ────────────────────────────────
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0', 'Accept': 'application/json' }
        }, res => {
            if ([301,302,303].includes(res.statusCode) && res.headers.location)
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function getCoursesLast48h() {
    const { from, to } = getDateRange();
    log(`Fetching courses ${from} → ${to} (last 48h IST)...`);
    state.dateFrom = from;
    state.dateTo   = to;

    const cutoffTime = Date.now() - 48 * 60 * 60 * 1000;
    const all  = [];
    let   page = 1;
    let   stop = false;

    while (!stop) {
        log(`  Page ${page}...`);
        try {
            const json    = await fetchJson(`https://freewebcart.com/api/courses?page=${page}`);
            const courses = json.data || json.courses || json || [];
            if (!Array.isArray(courses) || courses.length === 0) { log('  Done.'); break; }

            let n = 0;
            for (const c of courses) {
                if (!c.publishedAt) continue;
                const pubDate = c.publishedAt.substring(0, 10);
                if (pubDate >= from && pubDate <= to) {
                    if (c.publishedAt.length > 10) {
                        const pubMs = new Date(c.publishedAt).getTime();
                        if (!isNaN(pubMs) && pubMs < cutoffTime) continue;
                    }
                    const udemyUrl = c.sourceUrl || c.source_url || c.udemy_url || c.url || '';
                    if (udemyUrl && udemyUrl.includes('udemy.com/course')) {
                        all.push({ title: c.title, publishedAt: c.publishedAt, freewebcartUrl: `https://freewebcart.com/course/${c.slug}/`, udemyUrl });
                        n++;
                    } else { log(`  ⚠ No sourceUrl: ${c.title}`); }
                } else if (pubDate < from) { stop = true; break; }
            }
            log(`  Page ${page}: ${n} in window`);
            if (!stop) { page++; await sleep(300); }
        } catch(e) { log(`  Error: ${e.message}`); break; }
    }
    log(`Total in last 48h: ${all.length}`);
    return all;
}

function loadCookies(f) {
    const cookies = [];
    try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
            if (!line.trim() || line.startsWith('#')) continue;
            const p = line.split('\t');
            if (p.length >= 7) cookies.push({
                name: p[5].trim(), value: p[6].trim(),
                domain: p[0].trim().replace(/^\./, ''),
                path: p[2].trim(), secure: p[3].trim().toUpperCase() === 'TRUE', httpOnly: false
            });
        }
        log(`Loaded ${cookies.length} cookies`);
    } catch(e) { log('No cookie file'); }
    return cookies;
}

async function checkUdemyFree(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
        await sleep(4000);
        return await page.evaluate(() => {
            const txt = document.body.innerText || '';
            if (/\bFree\b/i.test(txt) && /100%\s*off/i.test(txt)) return true;
            const buySection = document.querySelector('[data-purpose="course-price-text--discount-price"]') || document.querySelector('[class*="discount-price"]');
            if (buySection && /\bFree\b/i.test(buySection.innerText)) return true;
            const allPriceEls = document.querySelectorAll('[class*="price"], [data-purpose*="price"]');
            for (const el of allPriceEls) {
                if (/\bFree\b/i.test(el.innerText) && /100%/i.test(el.innerText)) return true;
                if (/\bFree\b/i.test(el.innerText)) {
                    const parent = el.closest('[class*="price"], [class*="purchase"]') || el.parentElement;
                    if (parent && /100%\s*off|₹[0-9]/.test(parent.innerText)) return true;
                }
            }
            const priceEl   = document.querySelector('[data-purpose="course-price-text"]');
            const container = document.querySelector('[data-purpose="price-text-container"]');
            const enrollBtn = document.querySelector('[data-purpose="enroll-button"]');
            const cartBtn   = document.querySelector('[data-purpose="add-to-cart-button"]');
            if (container && /\bFree\b/i.test(container.innerText)) return true;
            if (priceEl   && /\bFree\b/i.test(priceEl.innerText))   return true;
            if (enrollBtn && !cartBtn) return true;
            if (priceEl) {
                const nums = priceEl.innerText.replace(/[,₹$£€\s]/g, '').match(/\d+/g);
                if (nums && nums.every(n => parseInt(n) === 0)) return true;
            }
            return false;
        });
    } catch(e) { return false; }
}

function saveResults(from, to, allItems, freeCourses) {
    const label      = from === to ? from : `${from}_to_${to}`;
    const outputFile = path.join(OUTPUT_DIR, `udemy_${label}.txt`);
    const sorted     = sortEnglishFirst(freeCourses);
    let out = `UDEMY FREE COURSES — Last 48 Hours\nWindow: ${from} → ${to} (IST)\nGenerated: ${new Date().toLocaleString()}\nChecked: ${allItems.length} | Free: ${freeCourses.length}\n${'='.repeat(60)}\n\n`;
    sorted.forEach((c, i) => { out += `${i + 1}. ${c.title}\n   Udemy: ${c.udemyUrl}\n   FWC  : ${c.freewebcartUrl}\n${'-'.repeat(50)}\n`; });
    if (!freeCourses.length) out += 'No free courses found.\n';
    fs.writeFileSync(outputFile, out, 'utf8');
    log(`Saved → ${outputFile}`);
}

async function runCheck() {
    if (state.running) { log('Already running, skipping...'); return; }
    state.running      = true;
    state.lastRun      = new Date().toISOString();
    state.nextRun      = new Date(Date.now() + INTERVAL_MS).toISOString();
    state.progress     = 0;
    state.currentTitle = 'Starting...';

    log(`\n${'='.repeat(50)}`);
    log('Run started — scanning last 48 hours');

    const allItems = await getCoursesLast48h();
    state.totalFound = allItems.length;
    if (!allItems.length) { log('No courses found.'); state.running = false; return; }

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
    const udPage  = await browser.newPage();
    await udPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36');
    await udPage.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

    const cookies = loadCookies(COOKIE_FILE);
    if (cookies.length) {
        await udPage.goto('https://www.udemy.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        for (const c of cookies) await udPage.setCookie(c).catch(() => {});
    }

    const newFree = [];
    for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        state.currentTitle = item.title;
        state.progress     = Math.round(((i + 1) / allItems.length) * 100);
        log(`[${i+1}/${allItems.length}] ${item.title.substring(0, 50)}...`);
        const isFree = await checkUdemyFree(udPage, item.udemyUrl);
        if (isFree) {
            log('  ✅ FREE!');
            newFree.push(item);
            if (!state.freeCourses.find(x => x.udemyUrl === item.udemyUrl))
                state.freeCourses.unshift({ ...item, foundAt: new Date().toLocaleTimeString() });
        } else { log('  💰 Paid'); }
    }

    await browser.close();
    state.currentTitle = 'Done';
    saveResults(state.dateFrom, state.dateTo, allItems, newFree);

    if (newFree.length > 0) await postAllCourses(newFree);
    else log('No free courses — skipping posts.');

    log(`Done — ${newFree.length} free course(s).`);
    state.running = false;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function startDashboard() {
    const server = http.createServer((req, res) => {
        if (req.url === '/api/state') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(state));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Udemy Free Checker</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Sora:wght@300;500;700&display=swap');
  :root{--bg:#0a0d14;--surface:#111827;--card:#161e2e;--border:#1f2d42;--accent:#00e5ff;--green:#00ff99;--yellow:#ffd166;--red:#ff4d6d;--blue:#3b82f6;--orange:#ff6b35;--linkedin:#0a66c2;--tg:#26a5e4;--tw:#1d9bf0;--text:#e2e8f0;--muted:#64748b}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'Sora',sans-serif;min-height:100vh;padding:22px}
  header{display:flex;align-items:center;gap:13px;margin-bottom:20px;flex-wrap:wrap}
  .dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 1.5s infinite;flex-shrink:0}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  h1{font-family:'Space Mono',monospace;font-size:1.1rem;letter-spacing:2px;color:var(--accent)}
  .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:.61rem;font-family:'Space Mono',monospace}
  .b-run{background:rgba(0,229,255,.15);color:var(--accent)}.b-idle{background:rgba(100,116,139,.15);color:var(--muted)}
  .b-on{background:rgba(0,255,153,.1);color:var(--green)}.b-off{background:rgba(100,116,139,.1);color:var(--muted)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:13px}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:12px}
  .sl{font-size:.58rem;letter-spacing:1.8px;color:var(--muted);text-transform:uppercase;margin-bottom:5px}
  .sv{font-family:'Space Mono',monospace;font-size:1.5rem;font-weight:700}
  .sv.g{color:var(--green)}.sv.b{color:var(--accent)}.sv.y{color:var(--yellow)}.sv.fb{color:var(--blue)}.sv.rd{color:var(--orange)}.sv.li{color:var(--linkedin)}.sv.tg{color:var(--tg)}.sv.tb{color:#8ab4d4}.sv.wp{color:#5ba4c8}.sv.tw{color:var(--tw)}
  .ss{font-size:.57rem;color:var(--muted);margin-top:2px;font-family:'Space Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-wrap{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:12px;margin-bottom:13px}
  .bar-meta{font-size:.7rem;color:var(--muted);margin-bottom:7px;display:flex;justify-content:space-between}
  .bar-track{background:var(--border);border-radius:99px;height:5px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--green));border-radius:99px;transition:width .4s}
  .cur{font-size:.73rem;color:var(--yellow);margin-top:6px;font-family:'Space Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .platforms{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:11px;margin-bottom:13px}
  .plat{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:13px}
  .plat-head{display:flex;align-items:center;gap:7px;margin-bottom:9px;flex-wrap:wrap}
  .plat-head h2{font-family:'Space Mono',monospace;font-size:.63rem;letter-spacing:2px;color:var(--muted);text-transform:uppercase;flex:1}
  .split-tag{font-family:'Space Mono',monospace;font-size:.57rem;padding:1px 6px;border-radius:3px}
  .split-no{background:rgba(0,255,153,.08);color:var(--green);border:1px solid rgba(0,255,153,.2)}
  .split-yes{background:rgba(255,213,102,.08);color:var(--yellow);border:1px solid rgba(255,213,102,.2)}
  .plat-setup{font-size:.7rem;color:var(--muted);line-height:1.6;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:9px}
  .plat-setup code{background:rgba(0,229,255,.1);color:var(--accent);font-family:'Space Mono',monospace;padding:1px 4px;border-radius:3px;font-size:.67rem}
  .ph-h{font-family:'Space Mono',monospace;font-size:.58rem;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:6px}
  .ph-list{display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto}
  .ph-item{border:1px solid var(--border);border-radius:5px;padding:6px 8px}
  .ph-item.ok-facebook{border-left:3px solid var(--blue)}.ph-item.ok-reddit{border-left:3px solid var(--orange)}.ph-item.ok-linkedin{border-left:3px solid var(--linkedin)}.ph-item.ok-telegram{border-left:3px solid var(--tg)}.ph-item.ok-tumblr{border-left:3px solid #8ab4d4}.ph-item.ok-wordpress{border-left:3px solid #5ba4c8}.ph-item.ok-twitter{border-left:3px solid var(--tw)}.ph-item.fail{border-left:3px solid var(--red)}
  .ph-time{font-family:'Space Mono',monospace;font-size:.58rem;color:var(--muted);margin-bottom:1px}
  .ph-prev{font-size:.7rem;color:var(--text);margin-bottom:2px;line-height:1.3}
  .ph-meta{font-size:.58rem;display:flex;gap:6px;flex-wrap:wrap}
  .ph-cnt{color:var(--green)}.ph-chr{color:var(--muted)}.ph-pt{color:var(--yellow)}.ph-err{color:var(--red)}
  .err-banner{background:rgba(255,77,109,.08);border:1px solid rgba(255,77,109,.2);border-radius:5px;padding:6px 9px;color:var(--red);font-size:.68rem;margin-top:6px;font-family:'Space Mono',monospace}
  .bottom{display:grid;grid-template-columns:2fr 1fr;gap:11px}
  @media(max-width:800px){.bottom{grid-template-columns:1fr}}
  .panel{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:13px;overflow:hidden}
  .panel h2{font-family:'Space Mono',monospace;font-size:.63rem;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:10px}
  .clist{display:flex;flex-direction:column;gap:7px;max-height:440px;overflow-y:auto}
  .ci{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--green);border-radius:6px;padding:8px}
  .ci.non-en{border-left-color:var(--yellow)}
  .ct{font-size:.78rem;font-weight:600;margin-bottom:3px;line-height:1.35}
  .cl{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:2px}
  .btn{font-size:.63rem;padding:2px 7px;border-radius:4px;text-decoration:none;font-family:'Space Mono',monospace}
  .bu{background:rgba(0,229,255,.09);color:var(--accent);border:1px solid rgba(0,229,255,.2)}
  .bf{background:rgba(0,255,153,.07);color:var(--green);border:1px solid rgba(0,255,153,.2)}
  .cft{font-size:.57rem;color:var(--muted)}
  .lang-tag{font-size:.55rem;padding:1px 5px;border-radius:3px;font-family:'Space Mono',monospace;background:rgba(255,213,102,.1);color:var(--yellow);border:1px solid rgba(255,213,102,.2)}
  .lw{font-family:'Space Mono',monospace;font-size:.63rem;color:var(--muted);max-height:440px;overflow-y:auto;line-height:1.9}
  .ll{border-bottom:1px solid #1a2236;padding:1px 0}
  .ll.free{color:var(--green)}.ll.fb{color:var(--blue)}.ll.reddit{color:var(--orange)}.ll.li{color:var(--linkedin)}.ll.tg{color:var(--tg)}.ll.tb{color:#8ab4d4}.ll.wp{color:#5ba4c8}.ll.tw{color:var(--tw)}.ll.err{color:var(--red)}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:var(--border)}::-webkit-scrollbar-thumb{background:var(--muted);border-radius:2px}
</style>
</head>
<body>
<header>
  <div class="dot" id="dot"></div>
  <h1>UDEMY FREE CHECKER</h1>
  <span class="badge b-idle" id="sb">IDLE</span>
  <span style="font-family:'Space Mono',monospace;font-size:.63rem;color:var(--muted)">⏱ 48hr · 7 platforms · EN first · OAuth 1.0a User Context</span>
</header>
<div class="stats">
  <div class="stat"><div class="sl">Window</div><div class="sv b" style="font-size:.74rem;margin-top:2px" id="s-win">—</div></div>
  <div class="stat"><div class="sl">Checked</div><div class="sv" id="s-tot">0</div></div>
  <div class="stat"><div class="sl">Free Found</div><div class="sv g" id="s-free">0</div></div>
  <div class="stat"><div class="sl">Next Run</div><div class="sv y" style="font-size:.82rem;margin-top:2px" id="s-next">—</div></div>
  <div class="stat"><div class="sl">FB</div><div class="sv fb" id="s-fb">0</div><div class="ss" id="s-fbt">—</div></div>
  <div class="stat"><div class="sl">Reddit</div><div class="sv rd" id="s-rd">0</div><div class="ss" id="s-rdt">—</div></div>
  <div class="stat"><div class="sl">LinkedIn</div><div class="sv li" id="s-li">0</div><div class="ss" id="s-lit">—</div></div>
  <div class="stat"><div class="sl">Telegram</div><div class="sv tg" id="s-tg">0</div><div class="ss" id="s-tgt">—</div></div>
  <div class="stat"><div class="sl">Tumblr</div><div class="sv tb" id="s-tb">0</div><div class="ss" id="s-tbt">—</div></div>
  <div class="stat"><div class="sl">WordPress</div><div class="sv wp" id="s-wp">0</div><div class="ss" id="s-wpt">—</div></div>
  <div class="stat"><div class="sl">Twitter/X</div><div class="sv tw" id="s-tw">0</div><div class="ss" id="s-twt">—</div></div>
</div>
<div class="bar-wrap">
  <div class="bar-meta"><span>Progress</span><span id="bp">0%</span></div>
  <div class="bar-track"><div class="bar-fill" id="bar" style="width:0%"></div></div>
  <div class="cur" id="cur">Waiting...</div>
</div>
<div class="platforms">
  <div class="plat">
    <div class="plat-head"><h2>📘 Facebook</h2><span class="split-tag split-no">NO SPLIT</span><span class="badge ${POST_TO_FACEBOOK?'b-on':'b-off'}">${POST_TO_FACEBOOK?'ON':'OFF'}</span></div>
    <div class="plat-setup">Event: <code>${IFTTT_FB_EVENT}</code><br>→ Facebook Pages → Create a status update → <code>{{Value1}}</code></div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-fb"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-fb" style="display:none" class="err-banner"></div>
  </div>
  <div class="plat">
    <div class="plat-head"><h2>🟠 Reddit</h2><span class="split-tag split-no">NO SPLIT</span><span class="badge ${POST_TO_REDDIT?'b-on':'b-off'}">${POST_TO_REDDIT?'ON':'OFF'}</span></div>
    <div class="plat-setup">Event: <code>${IFTTT_REDDIT_EVENT}</code><br>Title → <code>{{Value2}}</code> · Text → <code>{{Value1}}</code><br>Subreddit → <code>${REDDIT_SUBREDDIT}</code></div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-rd"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-rd" style="display:none" class="err-banner"></div>
  </div>
  <div class="plat">
    <div class="plat-head"><h2>💼 LinkedIn</h2><span class="split-tag split-yes">SPLIT ${LINKEDIN_CHAR_LIMIT}</span><span class="badge ${POST_TO_LINKEDIN?'b-on':'b-off'}">${POST_TO_LINKEDIN?'ON':'OFF'}</span></div>
    <div class="plat-setup">Event: <code>${IFTTT_LINKEDIN_EVENT}</code><br>→ Share an update → <code>{{Value1}}</code></div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-li"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-li" style="display:none" class="err-banner"></div>
  </div>
  <div class="plat">
    <div class="plat-head"><h2>✈️ Telegram</h2><span class="split-tag split-yes">SPLIT ${TELEGRAM_CHAR_LIMIT}</span><span class="badge ${POST_TO_TELEGRAM?'b-on':'b-off'}">${POST_TO_TELEGRAM?'ON':'OFF'}</span></div>
    <div class="plat-setup">Event: <code>${IFTTT_TELEGRAM_EVENT}</code><br>→ Send message → <code>{{Value1}}</code></div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-tg"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-tg" style="display:none" class="err-banner"></div>
  </div>
  <div class="plat">
    <div class="plat-head"><h2>📓 Tumblr</h2><span class="split-tag split-yes">HTML · SPLIT ${TUMBLR_CHAR_LIMIT}</span><span class="badge ${POST_TO_TUMBLR?'b-on':'b-off'}">${POST_TO_TUMBLR?'ON':'OFF'}</span></div>
    <div class="plat-setup">Event: <code>${IFTTT_TUMBLR_EVENT}</code><br>Title → <code>{{Value2}}</code> · Body → <code>{{Value1}}</code> · Tags → <code>{{Value3}}</code></div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-tb"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-tb" style="display:none" class="err-banner"></div>
  </div>
  <div class="plat">
    <div class="plat-head"><h2>🌐 WordPress</h2><span class="split-tag split-yes">HTML · SPLIT ${WORDPRESS_CHAR_LIMIT}</span><span class="badge ${POST_TO_WORDPRESS?'b-on':'b-off'}">${POST_TO_WORDPRESS?'ON':'OFF'}</span></div>
    <div class="plat-setup">Event: <code>${IFTTT_WORDPRESS_EVENT}</code><br>Title → <code>{{Value2}}</code> · Content → <code>{{Value1}}</code> · Tags → <code>{{Value3}}</code></div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-wp"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-wp" style="display:none" class="err-banner"></div>
  </div>
  <div class="plat">
    <div class="plat-head"><h2>🐦 Twitter / X</h2><span class="split-tag split-yes">OAUTH 1.0a · LONG + 🧵</span><span class="badge ${POST_TO_TWITTER?'b-on':'b-off'}">${POST_TO_TWITTER?'ON':'OFF'}</span></div>
    <div class="plat-setup">
      Direct v2 API · <code>client.readWrite</code> (User Context)<br>
      <span style="color:var(--green);font-size:.65rem">✅ Tries long post (${TWITTER_LONG_LIMIT} chars) first</span><br>
      <span style="color:var(--yellow);font-size:.65rem">🧵 Falls back to ${TWITTER_SHORT_LIMIT}-char tweet thread</span><br>
      <code>npm install twitter-api-v2</code>
    </div>
    <div class="ph-h">Post History</div><div class="ph-list" id="ph-tw"><p style="color:var(--muted);font-size:.7rem">No posts yet</p></div>
    <div id="err-tw" style="display:none" class="err-banner"></div>
  </div>
</div>
<div class="bottom">
  <div class="panel">
    <h2>✅ Free Courses — last 48 hrs (🟢 English · 🟡 Other)</h2>
    <div class="clist" id="clist"><p style="color:var(--muted);font-size:.8rem">No free courses yet</p></div>
  </div>
  <div class="panel">
    <h2>📋 Live Log</h2>
    <div class="lw" id="lw"></div>
  </div>
</div>
<script>
let lastFree=0,lastPostsLen=0;
function isNonEnglish(t){return/[\u0400-\u04FF\u0600-\u06FF\u0590-\u05FF\u3000-\u9FFF\uAC00-\uD7AF\u0900-\u097F\u0E00-\u0E7F]/.test(t)||/[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t);}
function countdown(iso){if(!iso)return'—';const d=new Date(iso)-Date.now();if(d<=0)return'Any moment...';const h=Math.floor(d/3600000),m=Math.floor((d%3600000)/60000),s=Math.floor((d%60000)/1000);return(h?h+'h ':'')+m+'m '+s+'s';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function renderPlatform(posts,platform,listId,errId){
  const filtered=posts.filter(p=>p.platform===platform);
  const lastErr=filtered.find(p=>p.error);
  const eb=document.getElementById(errId);
  if(lastErr){eb.style.display='block';eb.textContent='❌ '+lastErr.error;}else eb.style.display='none';
  document.getElementById(listId).innerHTML=filtered.length
    ?filtered.map(p=>\`<div class="ph-item \${p.error?'fail':'ok-'+p.platform}"><div class="ph-time">\${esc(p.time)}</div><div class="ph-prev">\${esc(p.preview)}</div><div class="ph-meta"><span class="ph-cnt">\${p.count} courses</span><span class="ph-chr">\${p.chars} chars</span>\${p.totalParts>1?'<span class="ph-pt">Part '+p.part+'/'+p.totalParts+'</span>':''}\${p.error?'<span class="ph-err">❌ '+esc(p.error)+'</span>':'<span style="color:var(--green)">✅ sent</span>'}</div></div>\`).join('')
    :'<p style="color:var(--muted);font-size:.7rem">No posts yet</p>';
}
async function poll(){
  try{
    const d=await(await fetch('/api/state')).json();
    document.getElementById('s-win').textContent=(d.dateFrom&&d.dateTo)?d.dateFrom+' → '+d.dateTo:'—';
    document.getElementById('s-tot').textContent=d.totalFound||0;
    document.getElementById('s-free').textContent=d.freeCourses.length;
    document.getElementById('s-next').textContent=countdown(d.nextRun);
    document.getElementById('bp').textContent=(d.progress||0)+'%';
    document.getElementById('bar').style.width=(d.progress||0)+'%';
    document.getElementById('cur').textContent=d.currentTitle||'';
    [['facebook','fb'],['reddit','rd'],['linkedin','li'],['telegram','tg'],['tumblr','tb'],['wordpress','wp'],['twitter','tw']].forEach(([p,k])=>{
      const arr=d.posts.filter(x=>x.platform===p);
      document.getElementById('s-'+k).textContent=arr.length;
      document.getElementById('s-'+k+'t').textContent=arr.length?'Last: '+arr[0].time:'Never';
    });
    const sb=document.getElementById('sb'),dot=document.getElementById('dot');
    if(d.running){sb.textContent='RUNNING';sb.className='badge b-run';dot.style.background='var(--accent)';dot.style.boxShadow='0 0 8px var(--accent)';}
    else{sb.textContent='IDLE';sb.className='badge b-idle';dot.style.background='var(--green)';dot.style.boxShadow='0 0 8px var(--green)';}
    if(d.posts.length!==lastPostsLen){
      lastPostsLen=d.posts.length;
      [['facebook','fb'],['reddit','rd'],['linkedin','li'],['telegram','tg'],['tumblr','tb'],['wordpress','wp'],['twitter','tw']].forEach(([p,k])=>renderPlatform(d.posts,p,'ph-'+k,'err-'+k));
    }
    if(d.freeCourses.length!==lastFree){
      lastFree=d.freeCourses.length;
      const sorted=[...d.freeCourses.filter(c=>!isNonEnglish(c.title)),...d.freeCourses.filter(c=>isNonEnglish(c.title))];
      document.getElementById('clist').innerHTML=sorted.length?sorted.map(c=>\`<div class="ci \${isNonEnglish(c.title)?'non-en':''}"><div class="ct">\${isNonEnglish(c.title)?'<span class="lang-tag">NON-EN</span> ':''}\${esc(c.title)}</div><div class="cl"><a href="\${esc(c.udemyUrl)}" target="_blank" class="btn bu">Udemy →</a><a href="\${esc(c.freewebcartUrl)}" target="_blank" class="btn bf">FWC →</a></div><div class="cft">📅 \${esc(c.publishedAt||'')} · Found \${c.foundAt||''}</div></div>\`).join(''):'<p style="color:var(--muted);font-size:.8rem">No free courses yet</p>';
    }
    document.getElementById('lw').innerHTML=d.log.map(l=>{
      const c=l.includes('✅ FREE')?'free':l.includes('❌')?'err':l.includes('📘')||l.includes('Facebook')?'fb':l.includes('🟠')||l.includes('Reddit')?'reddit':l.includes('💼')||l.includes('LinkedIn')?'li':l.includes('✈️')||l.includes('Telegram')?'tg':l.includes('📓')||l.includes('Tumblr')?'tb':l.includes('🌐')||l.includes('WordPress')?'wp':l.includes('🐦')||l.includes('Twitter')||l.includes('🧵')?'tw':'';
      return \`<div class="ll \${c}">\${esc(l)}</div>\`;
    }).join('');
  }catch(e){}
}
poll();setInterval(poll,3000);
</script>
</body>
</html>`);
    });
    server.listen(DASHBOARD_PORT, () => log(`Dashboard → http://localhost:${DASHBOARD_PORT}`));
}

async function main() {
    log('UDEMY FREE CHECKER — 7 platforms · English first · OAuth 1.0a User Context');
    log(`🐦 Twitter: uses client.readWrite → long post (${TWITTER_LONG_LIMIT}) → 🧵 thread fallback (${TWITTER_SHORT_LIMIT}/tweet)`);
    log(`Interval: ${INTERVAL_MS/60000}min | Dashboard: http://localhost:${DASHBOARD_PORT}`);
    startDashboard();
    await runCheck();
    setInterval(async () => { log('\n⏰ Scheduled run'); await runCheck(); }, INTERVAL_MS);
}

main().catch(console.error);
