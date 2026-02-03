import { config as loadEnv } from 'dotenv';
import path from 'path';

loadEnv();

export class Config {
    public readonly updateInterval: number = 3600 * 1000;
    public readonly port: number = 6565;
    public readonly dataDir: string = 'data';
    public readonly rssPath: string;
    public readonly stateFile: string;
    public readonly timetableCacheFile: string;
    public readonly faviconPath: string = 'favicon.svg';
    public readonly baseUrl: string;

    public readonly untisSchool: string;
    public readonly untisUser: string;
    public readonly untisSecret: string;
    public readonly untisServer: string;

    public readonly notifyTimetable: boolean;
    public readonly notifyExams: boolean;
    public readonly notifyAbsences: boolean;
    public readonly notifyMessages: boolean;

    constructor() {
        this.rssPath = path.join(this.dataDir, 'feed.xml');
        this.stateFile = path.join(this.dataDir, 'state.json');
        this.timetableCacheFile = path.join(this.dataDir, 'timetable_cache.json');

        const rawBaseUrl = process.env.BASE_URL || `http://localhost:${this.port}`;
        this.baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;

        this.untisSchool = this.getEnv('UNTIS_SCHOOL');
        this.untisUser = this.getEnv('UNTIS_USER');
        this.untisSecret = this.getEnv('UNTIS_PASSWORD');
        this.untisServer = this.getEnv('UNTIS_SERVER');

        this.notifyTimetable = process.env.NOTIFY_TIMETABLE_CHANGES === 'True';
        this.notifyExams = process.env.NOTIFY_EXAMS === 'True';
        this.notifyAbsences = process.env.NOTIFY_ABSENCES === 'True';
        this.notifyMessages = process.env.NOTIFY_MESSAGES === 'True';
    }

    private getEnv(key: string): string {
        const val = process.env[key];
        if (!val) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
        return val;
    }
}

export const config = new Config();
