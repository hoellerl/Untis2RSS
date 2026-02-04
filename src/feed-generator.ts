import { Feed } from 'feed';
import { promises as fs } from 'fs';
import { config } from './config.js';
import { Store } from './store.js';
import { UntisManager } from './untis-manager.js';
import { generateHash } from './helpers.js';
import { Change, PeriodEntry, TimetableCache, UntisPeriod, FeedItem } from './types.js';

export class FeedGenerator {
    private store: Store;
    private untisManager: UntisManager;

    constructor(store: Store, untisManager: UntisManager) {
        this.store = store;
        this.untisManager = untisManager;
    }

    async update(): Promise<void> {
        console.log(`[${new Date().toISOString()}] Refreshing WebUntis data...`);
        
        try {
            await this.untisManager.login();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`Update Loop Error: Login failed - ${msg}`);
            return;
        }

        const feed = new Feed({
            title: 'WebUntis Live Alerts',
            description: 'Personalized timetable changes, exams, and absences.',
            id: `${config.baseUrl}/feed.xml`,
            link: `${config.baseUrl}/feed.xml`,
            language: 'en',
            favicon: `${config.baseUrl}/${config.faviconPath}`,
            updated: new Date(),
            generator: 'Untis2RSS-Node',
        });

        const today = new Date();
        const schoolYear = await this.untisManager.getSchoolYear();
        const schoolYearStart = new Date(schoolYear.startDate);
        const schoolYearEnd = new Date(schoolYear.endDate);

        if (config.notifyTimetable) {
            await this.processTimetable(today);
        }

        if (config.notifyExams) {
            await this.processExams(schoolYearStart, schoolYearEnd);
        }

        if (config.notifyAbsences) {
            await this.processAbsences(schoolYearStart, schoolYearEnd);
        }

        if (config.notifyMessages) {
            await this.processMessages(today);
        }

        // Add history items to feed (sorted by date descending)
        const history = this.store.getHistory();
        history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        for (const item of history) {
            feed.addItem({
                title: item.title,
                id: item.id,
                link: item.link,
                description: item.description,
                date: new Date(item.date)
            });
        }

        // Prune history older than 7 days (604800000 ms)
        this.store.pruneHistory(7 * 24 * 60 * 60 * 1000);

        await fs.writeFile(config.rssPath, feed.rss2());
        await this.store.saveState();
        console.log('RSS feed updated.');

        await this.untisManager.logout();
    }

    private formatDate(date: Date): string {
        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
    }

    private async processTimetable(today: Date) {
        try {
            const lookahead = new Date();
            lookahead.setDate(today.getDate() + 14);

            const rawTimetable = await this.untisManager.getTimetable(today, lookahead);
            const newCache: TimetableCache = rawTimetable.reduce((acc: TimetableCache, period) => {
                acc[period.id] = this.periodToEntry(period);
                return acc;
            }, {});

            const oldCache = await this.store.loadTimetableCache();

            if (oldCache === null) {
                console.log("First run detected. Initializing timetable cache without notifications.");
                await this.store.saveTimetableCache(newCache);
            } else {
                const changes = this.diffTimetables(oldCache, newCache);
                const todayStr = today.toISOString().split('T')[0];
                
                // Find max date in old cache to handle sliding window
                let oldMaxDateStr = "";
                for (const key in oldCache) {
                    if (oldCache[key].date > oldMaxDateStr) oldMaxDateStr = oldCache[key].date;
                }

                for (const change of changes) {
                    const entry = change.new || change.old;
                    if (!entry) continue;

                    // Sliding window logic
                    if (change.type === 'removed' && change.old && change.old.date < todayStr) continue;
                    if (change.type === 'added' && change.new && oldMaxDateStr && change.new.date > oldMaxDateStr) continue;

                    const uidContent = { type: change.type, id: entry.id, data: change.new || change.old };
                    const uid = generateHash(uidContent);

                    if (!this.store.isSeen(uid)) {
                        this.addTimetableItem(change, entry, uid);
                        this.store.markSeen(uid);
                    }
                }
                await this.store.saveTimetableCache(newCache);
            }
        } catch (e) {
            console.error(`Timetable sync error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private addTimetableItem(change: Change, entry: PeriodEntry, uid: string) {
        let title = "Timetable Change";
        let description = "";
        const entryDate = new Date(entry.date);
        const formattedDate = this.formatDate(entryDate);

        if (change.type === 'added' && change.new?.code === 'irregular') {
            title = `🗓️ Event: ${change.new.lstext || 'Irregular Event'}`;
            description = `An event has been added on ${formattedDate} from ${entry.startTime} to ${entry.endTime}.`;
        } else if (change.type === 'updated') {
            if (change.new?.code === 'cancelled' && change.old?.code !== 'cancelled') {
                title = `❌ Lesson Cancelled: ${entry.subjects.join(', ')}`;
                description = `The lesson ${entry.subjects.join(', ')} at ${entry.startTime} on ${formattedDate} has been cancelled.`;
            } else if (change.new?.originalTeacher && !change.old?.originalTeacher) {
                const newTeacher = change.new.teachers[0];
                title = `🔄 Substitution: ${entry.subjects.join(', ')}`;
                description = `For ${entry.subjects.join(', ')} at ${entry.startTime}, ${newTeacher} is substituting for ${change.new.originalTeacher}.`;
            } else if (change.new?.code === 'irregular') {
                title = `🗓️ Event Update: ${change.new.lstext || 'Irregular Event'}`;
                description = `An event on ${formattedDate} has been updated.`;
            } else {
                title = `Lesson Updated: ${entry.subjects.join(', ')} on ${formattedDate}`;
                description = `A lesson at ${entry.startTime} has been updated.`;

                // Detailed diff description
                if (change.old && change.new) {
                    const diffs: string[] = [];
                    if (JSON.stringify(change.old.teachers) !== JSON.stringify(change.new.teachers)) {
                        diffs.push(`Teacher: ${change.old.teachers.join(', ')} ➔ ${change.new.teachers.join(', ')}`);
                    }
                    if (JSON.stringify(change.old.rooms) !== JSON.stringify(change.new.rooms)) {
                        diffs.push(`Room: ${change.old.rooms.join(', ')} ➔ ${change.new.rooms.join(', ')}`);
                    }
                    if (JSON.stringify(change.old.subjects) !== JSON.stringify(change.new.subjects)) {
                        diffs.push(`Subject: ${change.old.subjects.join(', ')} ➔ ${change.new.subjects.join(', ')}`);
                    }
                    if (change.old.startTime !== change.new.startTime || change.old.endTime !== change.new.endTime) {
                        diffs.push(`Time: ${change.old.startTime}-${change.old.endTime} ➔ ${change.new.startTime}-${change.new.endTime}`);
                    }
                    
                    if (diffs.length > 0) {
                        description += ` Changes: ${diffs.join(' | ')}`;
                    }
                }
            }
        } else if (change.type === 'added') {
            title = `New Lesson: ${entry.subjects.join(', ')} on ${formattedDate}`;
            description = `A new lesson has been added at ${entry.startTime}.`;
        } else if (change.type === 'removed') {
            title = `Lesson Removed: ${entry.subjects.join(', ')} on ${formattedDate}`;
            description = `A lesson has been removed at ${entry.startTime}.`;
        }

        const item: FeedItem = { title, id: uid, link: '', description, date: new Date().toISOString() };
        this.store.addToHistory(item);
    }

    private async processExams(start: Date, end: Date) {
        try {
            const exams = await this.untisManager.getExams(start, end);
            for (const exam of exams) {
                const uidContent = { type: 'exam', date: exam.examDate, subject: exam.subject, startTime: exam.startTime };
                const uid = generateHash(uidContent);

                if (!this.store.isSeen(uid)) {
                    const examDate = UntisManager.convertDate(exam.examDate);
                    const formattedDate = this.formatDate(examDate);
                    // Note: exam.teachers and exam.rooms are arrays of strings, not objects
                    const description = `Subject: ${exam.subject} | Teacher: ${exam.teachers.join(', ')} | Room: ${exam.rooms.join(', ')}`;
                    
                    const item: FeedItem = {
                        title: `📝 EXAM: ${exam.name} on ${formattedDate}`,
                        id: uid,
                        link: '',
                        description,
                        date: new Date().toISOString(),
                    };
                    this.store.addToHistory(item);
                    this.store.markSeen(uid);
                }
            }
        } catch (e) {
            console.error(`Exam fetch error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private async processAbsences(start: Date, end: Date) {
        try {
            const absenceData = await this.untisManager.getAbsences(start, end);
            for (const absence of absenceData.absences) {
                const uid = generateHash({ type: 'absence', id: absence.id, lastUpdate: absence.lastUpdate });
                if (!this.store.isSeen(uid)) {
                    const absenceDate = UntisManager.convertDate(absence.startDate);
                    const formattedDate = this.formatDate(absenceDate);
                    let title = `Absence Recorded: ${absence.reason}`;
                    if (absence.isExcused) title = `✅ Absence Excused: ${absence.reason}`;

                    let description = `Date: ${formattedDate} | Status: ${absence.excuseStatus} | Created by: ${absence.createdUser}`;
                    if (absence.isExcused && absence.excuse) {
                        const excuseDate = UntisManager.convertDate(absence.excuse.excuseDate);
                        description += ` | Excused by: ${absence.excuse.username} on ${this.formatDate(excuseDate)}`;
                    }

                    const item: FeedItem = { title, id: uid, link: '', description, date: new Date().toISOString() };
                    this.store.addToHistory(item);
                    this.store.markSeen(uid);
                }
            }
        } catch (e) {
            console.error(`Absence fetch error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private async processMessages(date: Date) {
        try {
            const news = await this.untisManager.getNews(date);
            if (news && news.messagesOfDay) {
                for (const message of news.messagesOfDay) {
                    const uid = generateHash({ type: 'message', id: message.id });
                    if (!this.store.isSeen(uid)) {
                        const item: FeedItem = {
                            title: `📢 NEWS: ${message.subject}`,
                            id: uid,
                            link: '',
                            description: message.text,
                            date: new Date().toISOString(),
                        };
                        this.store.addToHistory(item);
                        this.store.markSeen(uid);
                    }
                }
            }
        } catch (e) {
            console.error(`Message fetch error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private periodToEntry(period: UntisPeriod): PeriodEntry {
        return {
            id: period.id,
            date: UntisManager.convertDate(period.date).toISOString().split('T')[0],
            startTime: UntisManager.convertTime(period.startTime).toTimeString().substring(0, 5),
            endTime: UntisManager.convertTime(period.endTime).toTimeString().substring(0, 5),
            subjects: period.su.map(s => s.longname).sort(),
            teachers: period.te.map(t => t.longname).sort(),
            rooms: period.ro.map(r => r.longname).sort(),
            code: period.code || null,
            substText: period.substText || null,
            originalTeacher: period.te.find(t => t.orgname)?.orgname || null,
            lstext: period.lstext || null
        };
    }

    private diffTimetables(oldCache: TimetableCache, newCache: TimetableCache): Change[] {
        const changes: Change[] = [];
        const allKeys = new Set([...Object.keys(oldCache), ...Object.keys(newCache)]);

        for (const key of allKeys) {
            const oldEntry = oldCache[key];
            const newEntry = newCache[key];

            if (!oldEntry && newEntry) {
                changes.push({ type: 'added', new: newEntry });
            } else if (!newEntry && oldEntry) {
                changes.push({ type: 'removed', old: oldEntry });
            } else if (generateHash(oldEntry) !== generateHash(newEntry)) {
                changes.push({ type: 'updated', old: oldEntry, new: newEntry });
            }
        }
        return changes;
    }
}
