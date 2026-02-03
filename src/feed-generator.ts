import { Feed } from 'feed';
import { promises as fs } from 'fs';
import { config } from './config.js';
import { Store } from './store.js';
import { UntisManager } from './untis-manager.js';
import { generateHash } from './helpers.js';
import { Change, PeriodEntry, TimetableCache, UntisPeriod } from './types.js';

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
            await this.processTimetable(feed, today);
        }

        if (config.notifyExams) {
            await this.processExams(feed, schoolYearStart, schoolYearEnd);
        }

        if (config.notifyAbsences) {
            await this.processAbsences(feed, schoolYearStart, schoolYearEnd);
        }

        if (config.notifyMessages) {
            await this.processMessages(feed, today);
        }

        await fs.writeFile(config.rssPath, feed.rss2());
        await this.store.saveState();
        console.log('RSS feed updated.');

        await this.untisManager.logout();
    }

    private async processTimetable(feed: Feed, today: Date) {
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
                        this.addTimetableItem(feed, change, entry, uid);
                        this.store.markSeen(uid);
                    }
                }
                await this.store.saveTimetableCache(newCache);
            }
        } catch (e) {
            console.error(`Timetable sync error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private addTimetableItem(feed: Feed, change: Change, entry: PeriodEntry, uid: string) {
        let title = "Timetable Change";
        let description = "";

        if (change.type === 'added' && change.new?.code === 'irregular') {
            title = `🗓️ Event: ${change.new.lstext || 'Irregular Event'}`;
            description = `An event has been added on ${entry.date} from ${entry.startTime} to ${entry.endTime}.`;
        } else if (change.type === 'updated') {
            if (change.new?.code === 'cancelled' && change.old?.code !== 'cancelled') {
                title = `❌ Lesson Cancelled: ${entry.subjects.join(', ')}`;
                description = `The lesson ${entry.subjects.join(', ')} at ${entry.startTime} on ${entry.date} has been cancelled.`;
            } else if (change.new?.originalTeacher && !change.old?.originalTeacher) {
                const newTeacher = change.new.teachers[0];
                title = `🔄 Substitution: ${entry.subjects.join(', ')}`;
                description = `For ${entry.subjects.join(', ')} at ${entry.startTime}, ${newTeacher} is substituting for ${change.new.originalTeacher}.`;
            } else if (change.new?.code === 'irregular') {
                title = `🗓️ Event Update: ${change.new.lstext || 'Irregular Event'}`;
                description = `An event on ${entry.date} has been updated.`;
            } else {
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

        feed.addItem({ title, id: uid, link: '', description, date: new Date() });
    }

    private async processExams(feed: Feed, start: Date, end: Date) {
        try {
            const exams = await this.untisManager.getExams(start, end);
            for (const exam of exams) {
                const uidContent = { type: 'exam', date: exam.examDate, subject: exam.subject, startTime: exam.startTime };
                const uid = generateHash(uidContent);

                if (!this.store.isSeen(uid)) {
                    const examDate = UntisManager.convertDate(exam.examDate);
                    // Note: exam.teachers and exam.rooms are arrays of strings, not objects
                    const description = `Subject: ${exam.subject} | Teacher: ${exam.teachers.join(', ')} | Room: ${exam.rooms.join(', ')}`;
                    feed.addItem({
                        title: `📝 EXAM: ${exam.name} on ${examDate.toLocaleDateString()}`,
                        id: uid,
                        link: '',
                        description,
                        date: new Date(),
                    });
                    this.store.markSeen(uid);
                }
            }
        } catch (e) {
            console.error(`Exam fetch error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private async processAbsences(feed: Feed, start: Date, end: Date) {
        try {
            const absenceData = await this.untisManager.getAbsences(start, end);
            for (const absence of absenceData.absences) {
                const uid = generateHash({ type: 'absence', id: absence.id, lastUpdate: absence.lastUpdate });
                if (!this.store.isSeen(uid)) {
                    const absenceDate = UntisManager.convertDate(absence.startDate);
                    let title = `Absence Recorded: ${absence.reason}`;
                    if (absence.isExcused) title = `✅ Absence Excused: ${absence.reason}`;

                    let description = `Date: ${absenceDate.toLocaleDateString()} | Status: ${absence.excuseStatus} | Created by: ${absence.createdUser}`;
                    if (absence.isExcused && absence.excuse) {
                        description += ` | Excused by: ${absence.excuse.username} on ${UntisManager.convertDate(absence.excuse.excuseDate).toLocaleDateString()}`;
                    }

                    feed.addItem({ title, id: uid, link: '', description, date: new Date() });
                    this.store.markSeen(uid);
                }
            }
        } catch (e) {
            console.error(`Absence fetch error: ${e instanceof Error ? e.message : e}`);
        }
    }

    private async processMessages(feed: Feed, date: Date) {
        try {
            const news = await this.untisManager.getNews(date);
            if (news && news.messagesOfDay) {
                for (const message of news.messagesOfDay) {
                    const uid = generateHash({ type: 'message', id: message.id });
                    if (!this.store.isSeen(uid)) {
                        feed.addItem({
                            title: `📢 NEWS: ${message.subject}`,
                            id: uid,
                            link: '',
                            description: message.text,
                            date: new Date(),
                        });
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
