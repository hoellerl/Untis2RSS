import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebUntis } from 'webuntis';
import crypto from 'crypto';
import { config } from 'dotenv';
import {Feed} from 'feed';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPDATE_INTERVAL: number = 3600 * 1000; // 1 hour in milliseconds
const PORT: number = 6565;
const DATA_DIR: string = 'data';
const RSS_PATH: string = path.join(DATA_DIR, 'feed.xml');
const STATE_FILE: string = path.join(DATA_DIR, 'state.json');
const TIMETABLE_CACHE_FILE: string = path.join(DATA_DIR, 'timetable_cache.json');
const FAVICON_PATH: string = 'favicon.svg';

interface State {
    seen: string[];
}

let state: State = { seen: [] };

const ensureDataDir = async (): Promise<void> => {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error("Could not create data directory:", error);
    }
}

const loadState = async (): Promise<void> => {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        state = JSON.parse(data);
        if (!Array.isArray(state.seen)) {
            state.seen = [];
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log('No state file found, starting fresh.');
            state = { seen: [] };
        } else {
            console.error('Error loading state:', error);
        }
    }
};

const saveState = async (): Promise<void> => {
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving state:', error);
    }
};

interface PeriodEntry {
    id: number;
    date: string;
    startTime: string;
    endTime: string;
    subjects: string[];
    teachers: string[];
    rooms: string[];
    code: string | null;
    substText: string | null;
    originalTeacher: string | null;
    lstext: string | null;
}

interface TimetableCache {
    [key: string]: PeriodEntry;
}

const loadTimetableCache = async (): Promise<TimetableCache | null> => {
    try {
        const data = await fs.readFile(TIMETABLE_CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
};

const saveTimetableCache = async (snapshot: TimetableCache): Promise<void> => {
    try {
        await fs.writeFile(TIMETABLE_CACHE_FILE, JSON.stringify(snapshot, null, 2));
    } catch (error) {
        console.error('Error saving timetable cache:', error);
    }
};

const createUntisSession = (): WebUntis => {
    return new WebUntis(
        process.env.UNTIS_SCHOOL!,
        process.env.UNTIS_USER!,
        process.env.UNTIS_PASSWORD!,
        process.env.UNTIS_SERVER!,
        'UntisNodeBot/1.0'
    );
};

const generateUID = (content: any): string => {
    return crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex');
};

const periodToEntry = (period: any): PeriodEntry => {
    return {
        id: period.id,
        date: WebUntis.convertUntisDate(period.date).toISOString().split('T')[0],
        startTime: WebUntis.convertUntisTime(period.startTime).toTimeString().substring(0, 5),
        endTime: WebUntis.convertUntisTime(period.endTime).toTimeString().substring(0, 5),
        subjects: period.su.map((s: any) => s.longname).sort(),
        teachers: period.te.map((t: any) => t.longname).sort(),
        rooms: period.ro.map((r: any) => r.longname).sort(),
        code: period.code || null,
        substText: period.substText || null,
        originalTeacher: period.te.find((t: any) => t.orgname)?.orgname || null,
        lstext: period.lstext || null
    };
};

interface Change {
    type: 'added' | 'removed' | 'updated';
    old?: PeriodEntry;
    new?: PeriodEntry;
}

const diffTimetables = (oldCache: TimetableCache, newCache: TimetableCache): Change[] => {
    const changes: Change[] = [];
    const allKeys = new Set([...Object.keys(oldCache), ...Object.keys(newCache)]);

    for (const key of allKeys) {
        const oldEntry = oldCache[key];
        const newEntry = newCache[key];

        if (!oldEntry && newEntry) {
            changes.push({ type: 'added', new: newEntry });
        } else if (!newEntry && oldEntry) {
            changes.push({ type: 'removed', old: oldEntry });
        } else if (JSON.stringify(oldEntry) !== JSON.stringify(newEntry)) {
            changes.push({ type: 'updated', old: oldEntry, new: newEntry });
        }
    }
    return changes;
};


const fetchAndGenerateFeed = async (): Promise<void> => {
    console.log(`[${new Date().toISOString()}] Refreshing WebUntis data...`);
    const untis = createUntisSession();

    try {
        await untis.login();
    } catch (e: any) {
        console.error(`Update Loop Error: Login failed - ${e.message}`);
        return;
    }

    const feed = new Feed({
        title: 'WebUntis Live Alerts',
        description: 'Personalized timetable changes, exams, and absences.',
        id: `http://localhost:${PORT}/feed.xml`,
        link: `http://localhost:${PORT}/feed.xml`,
        language: 'en',
        favicon: `http://localhost:${PORT}/${FAVICON_PATH}`,
        updated: new Date(),
        generator: 'Untis2RSS-Node',
    });

    const today = new Date();
    const lookahead = new Date();
    lookahead.setDate(today.getDate() + 14);

    let schoolYear;
    try {
        schoolYear = await untis.getCurrentSchoolyear();
    } catch(e) {
        console.error("Could not fetch current school year. Falling back to programmatic dates.");
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        const startYear = currentMonth >= 8 ? currentYear : currentYear - 1;

        schoolYear = {
            startDate: new Date(startYear, 8, 1),
            endDate: new Date(startYear + 1, 7, 31)
        }
    }

    const schoolYearStart = new Date(schoolYear.startDate);
    const schoolYearEnd = new Date(schoolYear.endDate);


    if (process.env.NOTIFY_TIMETABLE_CHANGES === 'True') {
        try {
            const timetable = await untis.getOwnTimetableForRange(today, lookahead);
            const newCache: TimetableCache = timetable.reduce((acc: TimetableCache, period: any) => {
                acc[period.id] = periodToEntry(period);
                return acc;
            }, {});
            
            const oldCache = await loadTimetableCache();

            if (oldCache === null) {
                console.log("First run detected. Initializing timetable cache without notifications.");
                await saveTimetableCache(newCache);
            } else {
                const changes = diffTimetables(oldCache, newCache);
                
                // Calculate the max date present in the OLD cache to detect window expansion
                let oldMaxDateStr = "";
                for (const key in oldCache) {
                    if (oldCache[key].date > oldMaxDateStr) {
                        oldMaxDateStr = oldCache[key].date;
                    }
                }
                
                const todayStr = today.toISOString().split('T')[0];

                for (const change of changes) {
                    const entry = change.new || change.old;
                    if (!entry) continue;

                    // Filter out changes due to sliding window
                    if (change.type === 'removed' && change.old && change.old.date < todayStr) {
                        // Lesson fell out of the start of the window
                        continue;
                    }
                    if (change.type === 'added' && change.new && oldMaxDateStr && change.new.date > oldMaxDateStr) {
                        // Lesson entered the end of the window
                        continue;
                    }

                    const uidContent = { type: change.type, id: entry.id, data: change.new || change.old };
                    const uid = generateUID(uidContent);

                    if (!state.seen.includes(uid)) {
                        let title = "Timetable Change";
                        let description = "";

                        if (change.type === 'added' && change.new?.code === 'irregular') {
                            title = `🗓️ Event: ${change.new.lstext || 'Irregular Event'}`;
                            description = `An event has been added on ${entry.date} from ${entry.startTime} to ${entry.endTime}.`;
                        }
                        else if (change.type === 'updated') {
                            // Cancellation
                            if (change.new?.code === 'cancelled' && change.old?.code !== 'cancelled') {
                                title = `❌ Lesson Cancelled: ${entry.subjects.join(', ')}`;
                                description = `The lesson ${entry.subjects.join(', ')} at ${entry.startTime} on ${entry.date} has been cancelled.`;
                            }
                            // Substitution
                            else if (change.new?.originalTeacher && !change.old?.originalTeacher) {
                                const newTeacher = change.new.teachers[0];
                                title = `🔄 Substitution: ${entry.subjects.join(', ')}`;
                                description = `For ${entry.subjects.join(', ')} at ${entry.startTime}, ${newTeacher} is substituting for ${change.new.originalTeacher}.`;
                            }
                            // Irregular Event Update
                            else if (change.new?.code === 'irregular') {
                                title = `🗓️ Event Update: ${change.new.lstext || 'Irregular Event'}`;
                                description = `An event on ${entry.date} has been updated.`;
                            }
                            // Other updates
                            else {
                                 title = `Lesson Updated: ${entry.subjects.join(', ')} on ${entry.date}`;
                                 description = `A lesson at ${entry.startTime} has been updated.`;
                            }
                        } else if (change.type === 'added') {
                            title = `New Lesson: ${entry.subjects.join(', ')} on ${entry.date}`;
                            description = `A new lesson has been added at ${entry.startTime}.`;
                        } else if (change.type === 'removed') {
                            title = `Lesson Removed: ${entry.subjects.join(', ')} on ${entry.date}`;
                            description = `A lesson has been removed at ${entry.startTime}.`;
                        }

                        feed.addItem({
                            title,
                            id: uid,
                            link: '',
                            description,
                            date: new Date(),
                        });
                        state.seen.push(uid);
                    }
                }
                await saveTimetableCache(newCache);
            }
        } catch (e: any) {
            console.error(`Timetable sync error: ${e.message}`);
        }
    }

    if (process.env.NOTIFY_EXAMS === 'True') {
        try {
            const exams = await untis.getExamsForRange(schoolYearStart, schoolYearEnd);
            for (const exam of exams) {
                // Use a composite key because exam.id is always 0
                const uidContent = { 
                    type: 'exam', 
                    date: exam.examDate, 
                    subject: exam.subject, 
                    startTime: exam.startTime 
                };
                const uid = generateUID(uidContent);
                
                if (!state.seen.includes(uid)) {
                    const examDate = WebUntis.convertUntisDate(String(exam.examDate));
                    const description = `Subject: ${exam.subject} | Teacher: ${exam.teachers.join(', ')} | Room: ${exam.rooms.join(', ')}`;
                    feed.addItem({
                        title: `📝 EXAM: ${exam.name} on ${examDate.toLocaleDateString()}`,
                        id: uid,
                        link: '',
                        description,
                        date: new Date(),
                    });
                    state.seen.push(uid);
                }
            }
        } catch (e: any) {
            console.error(`Exam fetch error: ${e.message}`);
        }
    }

    if (process.env.NOTIFY_ABSENCES === 'True') {
        try {
            const absenceData = await untis.getAbsentLesson(schoolYearStart, schoolYearEnd);
            for (const absence of absenceData.absences) {
                const uid = generateUID({ type: 'absence', id: absence.id, lastUpdate: absence.lastUpdate });
                if (!state.seen.includes(uid)) {
                    const absenceDate = WebUntis.convertUntisDate(String(absence.startDate));
                    let title = `Absence Recorded: ${absence.reason}`;
                    if (absence.isExcused) {
                        title = `✅ Absence Excused: ${absence.reason}`;
                    }

                    let description = `Date: ${absenceDate.toLocaleDateString()} | Status: ${absence.excuseStatus} | Created by: ${absence.createdUser}`;
                    if(absence.isExcused && absence.excuse) {
                        description += ` | Excused by: ${absence.excuse.username} on ${WebUntis.convertUntisDate(String(absence.excuse.excuseDate)).toLocaleDateString()}`;
                    }

                    feed.addItem({
                        title,
                        id: uid,
                        link: '',
                        description,
                        date: new Date(),
                    });
                    state.seen.push(uid);
                }
            }
        } catch (e: any) {
            console.error(`Absence fetch error: ${e.message}`);
        }
    }

    if (process.env.NOTIFY_MESSAGES === 'True') {
        try {
            const news = await untis.getNewsWidget(today);
            if (news && news.messagesOfDay) {
                for (const message of news.messagesOfDay) {
                    const uid = generateUID({ type: 'message', id: message.id });
                    if (!state.seen.includes(uid)) {
                        feed.addItem({
                            title: `📢 NEWS: ${message.subject}`,
                            id: uid,
                            link: '',
                            description: message.text,
                            date: new Date(),
                        });
                        state.seen.push(uid);
                    }
                }
            }
        } catch (e: any) {
            console.error(`Message fetch error: ${e.message}`);
        }
    }


    await fs.writeFile(RSS_PATH, feed.rss2());
    await saveState();
    console.log('RSS feed updated.');

    await untis.logout();
};

const startServer = (): void => {
    const server = http.createServer(async (req, res) => {
        if (req.url === `/feed.xml`) {
            try {
                const rssFeed = await fs.readFile(RSS_PATH, 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
                res.end(rssFeed);
            } catch (error) {
                res.writeHead(404);
                res.end('Feed not found. Please wait for the first fetch.');
            }
        } else if (req.url === `/${FAVICON_PATH}`) {
            try {
                const favicon = await fs.readFile(path.join(__dirname, FAVICON_PATH));
                res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
                res.end(favicon);
            } catch (error) {
                res.writeHead(404);
                res.end('Favicon not found.');
            }
        } else if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        }
        else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(PORT, () => {
        console.log(`Server started at http://localhost:${PORT}/feed.xml`);
    });
};

const main = async (): Promise<void> => {
    await ensureDataDir();
    await loadState();
    await fetchAndGenerateFeed();
    setInterval(fetchAndGenerateFeed, UPDATE_INTERVAL);
    startServer();
};

main().catch(error => {
    console.error("Critical error in main execution:", error);
});
