import { WebUntis } from 'webuntis';
import { config } from './config.js';
import { UntisPeriod, UntisExam, UntisAbsenceResponse, UntisNewsWidget } from './types.js';

export class UntisManager {
    private untis: WebUntis;

    constructor() {
        this.untis = new WebUntis(
            config.untisSchool,
            config.untisUser,
            config.untisSecret,
            config.untisServer,
            'UntisNodeBot/1.0'
        );
    }

    async login(): Promise<void> {
        await this.untis.login();
    }

    async logout(): Promise<void> {
        await this.untis.logout();
    }

    async getSchoolYear() {
        try {
            return await this.untis.getCurrentSchoolyear();
        } catch (e) {
            console.warn("Could not fetch current school year. Falling back to programmatic dates.");
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth();
            const startYear = currentMonth >= 8 ? currentYear : currentYear - 1;
            return {
                startDate: new Date(startYear, 8, 1),
                endDate: new Date(startYear + 1, 7, 31)
            };
        }
    }

    async getTimetable(start: Date, end: Date): Promise<UntisPeriod[]> {
        return await this.untis.getOwnTimetableForRange(start, end) as unknown as UntisPeriod[];
    }

    async getExams(start: Date, end: Date): Promise<UntisExam[]> {
        return await this.untis.getExamsForRange(start, end) as unknown as UntisExam[];
    }

    async getAbsences(start: Date, end: Date): Promise<UntisAbsenceResponse> {
        return await this.untis.getAbsentLesson(start, end) as unknown as UntisAbsenceResponse;
    }

    async getNews(date: Date): Promise<UntisNewsWidget> {
        return await this.untis.getNewsWidget(date) as unknown as UntisNewsWidget;
    }

    static convertDate(date: number | string): Date {
        return WebUntis.convertUntisDate(String(date));
    }

    static convertTime(time: number): Date {
        return WebUntis.convertUntisTime(time);
    }
}
