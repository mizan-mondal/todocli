/**
 * Client-Side Natural Language Processing (NLP) & Date Parsing Utility
 * Runs 100% on the user's browser device using local computing power.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];
const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Returns ordinal suffix for day of month (e.g., 1st, 2nd, 3rd, 23rd)
 */
export function getOrdinalSuffix(day) {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

/**
 * Formats a Date object into human-friendly confirmation string:
 * e.g., "Friday, 23rd October 2026"
 */
export function formatDateNice(date) {
  if (!date || isNaN(date.getTime())) return '';
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${dayName}, ${getOrdinalSuffix(dayNum)} ${monthName} ${year}`;
}

/**
 * Formats a short badge for list output:
 * e.g., "[Due: Fri, 23 Oct 2026]" or "[OVERDUE: 18 Oct 2026]" or "[DUE TODAY]"
 */
export function formatDeadlineBadge(deadlineDate) {
  if (!deadlineDate) return '';
  const date = deadlineDate instanceof Date ? deadlineDate : new Date(deadlineDate);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 3600 * 1000);

  const dayStr = date.toLocaleDateString('en-US', { weekday: 'short' });
  const monthStr = date.toLocaleDateString('en-US', { month: 'short' });
  const dateNum = date.getDate();
  const year = date.getFullYear();

  if (date < todayStart) {
    return `[OVERDUE: ${dateNum} ${monthStr} ${year}]`;
  } else if (date <= todayEnd) {
    return '[DUE TODAY]';
  } else if (date <= tomorrowEnd) {
    return '[DUE TOMORROW]';
  } else {
    return `[Due: ${dayStr}, ${dateNum} ${monthStr} ${year}]`;
  }
}

/**
 * Determines task urgency category for CSS styling:
 * 'overdue' | 'due-soon' | 'upcoming' | 'none'
 */
export function getTaskUrgency(deadlineDate) {
  if (!deadlineDate) return 'none';
  const date = deadlineDate instanceof Date ? deadlineDate : new Date(deadlineDate);
  if (isNaN(date.getTime())) return 'none';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (date < todayStart) {
    return 'overdue';
  }

  // Due within 48 hours is considered 'due-soon'
  const msDiff = date.getTime() - now.getTime();
  if (msDiff <= 48 * 3600 * 1000) {
    return 'due-soon';
  }

  return 'upcoming';
}

/**
 * Parses manual date input (e.g. DDMMYY, DD/MM/YY, DD-MM-YY, DD/MM/YYYY, or natural words)
 */
export function parseManualDate(input) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (raw === 'n' || raw === 'no' || raw === 'none' || raw === 'cancel') {
    return null;
  }

  // 1. Check purely 6 digits DDMMYY (e.g. 281026)
  if (/^\d{6}$/.test(raw)) {
    const day = parseInt(raw.slice(0, 2), 10);
    const month = parseInt(raw.slice(2, 4), 10);
    const year = 2000 + parseInt(raw.slice(4, 6), 10);
    return createValidDate(year, month, day);
  }

  // 2. Check 8 digits DDMMYYYY (e.g. 28102026)
  if (/^\d{8}$/.test(raw)) {
    const day = parseInt(raw.slice(0, 2), 10);
    const month = parseInt(raw.slice(2, 4), 10);
    const year = parseInt(raw.slice(4, 8), 10);
    return createValidDate(year, month, day);
  }

  // 3. Check delimited format DD/MM/YY or DD-MM-YY or DD.MM.YY
  const matchDelim = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (matchDelim) {
    const day = parseInt(matchDelim[1], 10);
    const month = parseInt(matchDelim[2], 10);
    let year = parseInt(matchDelim[3], 10);
    if (year < 100) year += 2000;
    return createValidDate(year, month, day);
  }

  // 4. Check ISO YYYY-MM-DD
  const matchIso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (matchIso) {
    const year = parseInt(matchIso[1], 10);
    const month = parseInt(matchIso[2], 10);
    const day = parseInt(matchIso[3], 10);
    return createValidDate(year, month, day);
  }

  // 5. Try natural language expression for manual input (e.g. "friday", "tomorrow")
  const natural = parseNaturalDeadline(`dummy by ${raw}`);
  if (natural && natural.hasNlpCue && natural.dateObj) {
    return natural.dateObj;
  }

  return null;
}

function createValidDate(year, month, day) {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Set to end of day 23:59:59 local time
  const d = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
    return d;
  }
  return null;
}

/**
 * Checks for explicit --by flag in command text:
 * e.g., "Submit report --by 281026" or "Buy groceries --by n"
 */
export function extractExplicitDeadlineFlag(rawText) {
  const flagRegex = /\s+--by\s+(\S+)\s*$/i;
  const match = rawText.match(flagRegex);
  if (!match) return null;

  const flagValue = match[1].trim();
  const cleanedText = rawText.replace(flagRegex, '').trim();

  if (flagValue.toLowerCase() === 'n' || flagValue.toLowerCase() === 'none') {
    return {
      isExplicit: true,
      hasDeadline: false,
      deadlineDate: null,
      cleanedText,
      displayMsg: 'No deadline set (flag --by n).'
    };
  }

  const parsedDate = parseManualDate(flagValue);
  if (!parsedDate) {
    return {
      isExplicit: true,
      error: `Invalid date '${flagValue}' in --by flag. Use DDMMYY format (e.g. 281026) or "n" for no deadline.`
    };
  }

  return {
    isExplicit: true,
    hasDeadline: true,
    deadlineDate: parsedDate,
    cleanedText,
    formatted: formatDateNice(parsedDate)
  };
}

/**
 * Natural Language Date Extraction from task description
 * Runs purely on client side.
 */
export function parseNaturalDeadline(taskText) {
  if (!taskText) {
    return { hasNlpCue: false, cleanedTaskName: '', deadline: null };
  }

  const text = taskText.trim();
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

  // 1. Check with trigger preposition: by, before, on, due, until
  // e.g. "by friday", "on this saturday", "by next wednesday", "by 29 oct", "due tomorrow"
  const triggerRegex = /(?:^|\s+)(?:by|before|on|due\s+on|due|until)\s+(.+)$/i;
  const triggerMatch = text.match(triggerRegex);

  let candidatePhrase = '';
  let matchIndex = -1;

  if (triggerMatch) {
    candidatePhrase = triggerMatch[1].trim().toLowerCase();
    matchIndex = triggerMatch.index;
  } else {
    // 2. Check without preposition if ending with known date expressions:
    // e.g. "next wednesday", "this saturday", "tomorrow", "today", "29 oct", "in 3 days"
    const directPatterns = [
      /(?:^|\s+)((?:this|next)\s+[a-z]+)$/i,
      /(?:^|\s+)(tomorrow|today|tonight)$/i,
      /(?:^|\s+)(in\s+\d+\s+(?:day|days|week|weeks))$/i,
      /(?:^|\s+)(\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+)$/i,
      /(?:^|\s+)([a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)$/i,
      /(?:^|\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|tues|thur|thurs)$/i
    ];

    for (const pattern of directPatterns) {
      const match = text.match(pattern);
      if (match) {
        candidatePhrase = match[1].trim().toLowerCase();
        matchIndex = match.index;
        break;
      }
    }
  }

  if (!candidatePhrase) {
    return { hasNlpCue: false, cleanedTaskName: text, deadline: null };
  }

  let targetDate = null;

  // A. "today" or "tonight"
  if (candidatePhrase === 'today' || candidatePhrase === 'tonight') {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }

  // B. "tomorrow"
  else if (candidatePhrase === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  // C. "this <weekday>" (e.g. "this saturday", "this friday")
  else if (/^this\s+([a-z]+)$/i.test(candidatePhrase)) {
    const dayWord = candidatePhrase.match(/^this\s+([a-z]+)$/i)[1];
    const targetIdx = getWeekdayIndex(dayWord);
    if (targetIdx !== -1) {
      const diff = (targetIdx - currentDay + 7) % 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }
  }

  // D. "next <weekday>" (e.g. "next thursday") -> skip this coming one, go to following week
  else if (/^next\s+([a-z]+)$/i.test(candidatePhrase)) {
    const dayWord = candidatePhrase.match(/^next\s+([a-z]+)$/i)[1];
    const targetIdx = getWeekdayIndex(dayWord);
    if (targetIdx !== -1) {
      // Days to this coming instance:
      let diff = (targetIdx - currentDay + 7) % 7;
      // Skip this upcoming one, add 7 more days:
      diff += 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }
  }

  // E. Plain weekday (e.g. "friday", "monday")
  else if (getWeekdayIndex(candidatePhrase) !== -1) {
    const targetIdx = getWeekdayIndex(candidatePhrase);
    let diff = (targetIdx - currentDay + 7) % 7;
    // If diff is 0 (i.e. today is that day), default to today end-of-day
    const d = new Date(now);
    d.setDate(d.getDate() + diff);
    targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  // F. Date expressions: "29 oct", "29th october", "oct 29", "october 29th"
  else {
    const dateMatch = parseDayMonthExpression(candidatePhrase);
    if (dateMatch) {
      targetDate = dateMatch;
    }
  }

  // G. "in X days" or "in X weeks"
  if (!targetDate) {
    const inMatch = candidatePhrase.match(/^in\s+(\d+)\s+(day|days|week|weeks)$/i);
    if (inMatch) {
      const num = parseInt(inMatch[1], 10);
      const unit = inMatch[2].toLowerCase();
      const addDays = unit.startsWith('week') ? num * 7 : num;
      const d = new Date(now);
      d.setDate(d.getDate() + addDays);
      targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }
  }

  if (!targetDate) {
    return { hasNlpCue: false, cleanedTaskName: text, deadline: null };
  }

  // Clean the task name by removing the matched trigger and date expression
  const cleanedTaskName = text.slice(0, matchIndex).trim();

  return {
    hasNlpCue: true,
    cleanedTaskName: cleanedTaskName || text,
    dateObj: targetDate,
    deadline: targetDate.toISOString(),
    formattedDisplay: formatDateNice(targetDate)
  };
}

function getWeekdayIndex(word) {
  const clean = word.toLowerCase();
  const full = DAYS.indexOf(clean);
  if (full !== -1) return full;
  const short = SHORT_DAYS.indexOf(clean.slice(0, 3));
  if (short !== -1) return short;
  if (clean === 'tues') return 2;
  if (clean === 'thur' || clean === 'thurs') return 4;
  return -1;
}

function parseDayMonthExpression(phrase) {
  const now = new Date();
  const currentYear = now.getFullYear();

  // "29 oct", "29th october", "29 october"
  const m1 = phrase.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/i);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const monthIdx = getMonthIndex(m1[2]);
    if (monthIdx !== -1) {
      return buildDateWithRollover(currentYear, monthIdx, day);
    }
  }

  // "oct 29", "october 29th", "oct 29th"
  const m2 = phrase.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (m2) {
    const monthIdx = getMonthIndex(m2[1]);
    const day = parseInt(m2[2], 10);
    if (monthIdx !== -1) {
      return buildDateWithRollover(currentYear, monthIdx, day);
    }
  }

  return null;
}

function getMonthIndex(word) {
  const clean = word.toLowerCase();
  const full = MONTHS.indexOf(clean);
  if (full !== -1) return full;
  const short = SHORT_MONTHS.indexOf(clean.slice(0, 3));
  if (short !== -1) return short;
  return -1;
}

function buildDateWithRollover(currentYear, monthIdx, day) {
  const now = new Date();
  let year = currentYear;
  let testDate = new Date(year, monthIdx, day, 23, 59, 59, 999);

  // If the date in current year has already passed, roll over to next year
  if (testDate < now) {
    year += 1;
    testDate = new Date(year, monthIdx, day, 23, 59, 59, 999);
  }

  if (testDate.getMonth() === monthIdx && testDate.getDate() === day) {
    return testDate;
  }
  return null;
}
