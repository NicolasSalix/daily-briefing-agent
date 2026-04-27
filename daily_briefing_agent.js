'use strict';

const { Client: NotionClient } = require('@notionhq/client');
const { google } = require('googleapis');
const { default: Anthropic } = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

const TEST_MODE = process.argv.includes('--test');
const TIMEZONE = 'America/Sao_Paulo';
const NOTION_DB = 'd1b18db1-fa8f-49fd-aea3-8670b796439d';
const EMAIL_TO = 'ngspielmann@gmail.com';
const EMAIL_FROM = 'ngspielmann@gmail.com';

// ─── Notion ───────────────────────────────────────────────────────────────────

async function fetchNotionTasks() {
  const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });

  try {
    const response = await notion.databases.query({
      database_id: NOTION_DB,
      filter: {
        or: [
          { property: 'Status', status: { equals: 'To-Do' } },
          { property: 'Status', status: { equals: 'Urgent' } },
        ],
      },
      sorts: [{ property: 'Status', direction: 'descending' }],
    });

    return response.results.map(page => {
      const p = page.properties;
      const name =
        p.Name?.title?.[0]?.plain_text ||
        p.Task?.title?.[0]?.plain_text ||
        p.Title?.title?.[0]?.plain_text ||
        'Untitled';
      const status = p.Status?.status?.name || 'Unknown';
      const dueDate = p['Due Date']?.date?.start || p.Due?.date?.start || null;
      const priority =
        p.Priority?.select?.name ||
        p.Priority?.multi_select?.[0]?.name ||
        null;
      return { name, status, dueDate, priority };
    });
  } catch (err) {
    console.error('  ❌ Notion error:', err.message);
    return null;
  }
}

// ─── Google Calendar ──────────────────────────────────────────────────────────

async function fetchCalendarEvents() {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({ refresh_token: process.env.CALENDAR_TOKEN });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Today's boundaries in São Paulo (UTC-3, no DST since 2019)
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const timeMin = new Date(`${todayStr}T00:00:00-03:00`).toISOString();
    const timeMax = new Date(`${todayStr}T23:59:59-03:00`).toISOString();

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(event => {
      const allDay = !event.start.dateTime;
      if (allDay) {
        return { title: event.summary || 'Untitled', allDay: true, start: '', end: '', duration: '' };
      }

      const startDate = new Date(event.start.dateTime);
      const endDate = new Date(event.end.dateTime);
      const mins = Math.round((endDate - startDate) / 60000);
      const fmt = d => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
      const duration = mins >= 60
        ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`
        : `${mins}m`;

      return { title: event.summary || 'Untitled', allDay: false, start: fmt(startDate), end: fmt(endDate), duration };
    });
  } catch (err) {
    console.error('  ❌ Calendar error:', err.message);
    return null;
  }
}

// ─── Claude ───────────────────────────────────────────────────────────────────

function buildTasksText(tasks) {
  if (tasks === null) return 'No tasks loaded (Notion connection failed).';
  if (tasks.length === 0) return 'No To-Do or Urgent tasks found.';
  return tasks.map(t =>
    `- ${t.name} | Status: ${t.status}` +
    (t.dueDate ? ` | Due: ${t.dueDate}` : '') +
    (t.priority ? ` | Priority: ${t.priority}` : ''),
  ).join('\n');
}

function buildEventsText(events) {
  if (events === null) return 'No calendar data loaded (Calendar connection failed).';
  if (events.length === 0) return 'No events today.';
  return events.map(e =>
    e.allDay ? `- ${e.title} (all day)` : `- ${e.title} | ${e.start} – ${e.end} (${e.duration})`,
  ).join('\n');
}

async function generateBriefing(tasks, events) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TIMEZONE,
  });

  const userPrompt =
    `Today is ${today} (São Paulo time).\n\n` +
    `TASKS:\n${buildTasksText(tasks)}\n\n` +
    `CALENDAR:\n${buildEventsText(events)}\n\n` +
    `Generate the daily briefing in EXACTLY this format:\n\n` +
    `🎯 TOP PRIORITY\n[1-2 sentences: most urgent task with deadline]\n\n` +
    `⏳ WAITING ON\n[1-2 sentences: what's blocked, who you're waiting for]\n\n` +
    `🔴 AT RISK\n[1-2 sentences: anything that might slip or is overdue]\n\n` +
    `✅ QUICK WINS\n[1-2 sentences: easy tasks to knock out today]\n\n` +
    `⏰ TIME BLOCKS\n[2-3 sentences: how to structure the day based on calendar]`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: "You are Nico's daily briefing assistant. Analyze his tasks and calendar to create an intelligent, prioritized daily plan. Focus on what matters most and what's at risk. Be concise and actionable.",
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    return response.content[0].text;
  } catch (err) {
    console.error('  ❌ Claude error:', err.message);
    return (
      `⚠️ Claude API error: ${err.message}\n\n` +
      `Raw data for manual review:\n\nTASKS:\n${buildTasksText(tasks)}\n\nCALENDAR:\n${buildEventsText(events)}`
    );
  }
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(subject, briefing) {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #f9f9f9; }
  .card { background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size: 20px; margin: 0 0 20px; color: #111; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 15px; line-height: 1.75; margin: 0; }
  .footer { margin-top: 16px; font-size: 11px; color: #aaa; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <h1>${subject}</h1>
    <pre>${briefing.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>
  <div class="footer">Daily Briefing Agent · ${new Date().toISOString()}</div>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_FROM, pass: process.env.GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `Daily Briefing <${EMAIL_FROM}>`,
    to: EMAIL_TO,
    subject,
    text: briefing,
    html,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Daily Briefing Agent starting...');
  console.log(`   Mode: ${TEST_MODE ? 'TEST (console only, no email)' : 'PRODUCTION (email will be sent)'}\n`);

  console.log('📋 Fetching Notion tasks...');
  const tasks = await fetchNotionTasks();
  if (tasks !== null) console.log(`   ✅ ${tasks.length} task(s) loaded`);

  console.log('📅 Fetching Google Calendar events...');
  const events = await fetchCalendarEvents();
  if (events !== null) console.log(`   ✅ ${events.length} event(s) loaded`);

  console.log('🤖 Generating briefing with Claude...');
  const briefing = await generateBriefing(tasks, events);

  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: TIMEZONE,
  });
  const subject = `📅 Daily Briefing — ${dateStr}`;

  console.log('\n' + '─'.repeat(60));
  console.log(subject);
  console.log('─'.repeat(60));
  console.log(briefing);
  console.log('─'.repeat(60) + '\n');

  if (TEST_MODE) {
    console.log('✅ Test complete — email not sent.');
    return;
  }

  console.log('📧 Sending email...');
  await sendEmail(subject, briefing);
  console.log(`   ✅ Email sent to ${EMAIL_TO}`);
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
