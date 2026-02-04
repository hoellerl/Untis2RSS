import { UntisManager } from './untis-manager.js';
import { UntisPeriod, UntisExam, UntisAbsenceResponse, UntisNewsWidget } from './types.js';

export class MockUntisManager extends UntisManager {
    private counter = 0;

    constructor() {
        super();
        console.log("⚠️ STARTED IN MOCK MODE ⚠️");
    }

    async login(): Promise<void> {
        console.log("[Mock] Login successful");
    }

    async logout(): Promise<void> {
        console.log("[Mock] Logout successful (Cycle complete)");
        this.counter++;
    }

    async getSchoolYear() {
        const now = new Date();
        return {
            startDate: new Date(now.getFullYear(), 0, 1),
            endDate: new Date(now.getFullYear(), 11, 31)
        };
    }

    async getTimetable(start: Date, end: Date): Promise<UntisPeriod[]> {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
        const dateNum = parseInt(dateStr);

        // Base lesson: Math at 8:00
        const periods: UntisPeriod[] = [
            {
                id: 1001,
                date: dateNum,
                startTime: 800,
                endTime: 845,
                kl: [{ id: 1, name: '10A', longname: '10A' }],
                te: [{ id: 1, name: 'MUSTER', longname: 'Max Mustermann' }],
                su: [{ id: 1, name: 'MATH', longname: 'Mathematics' }],
                ro: [{ id: 1, name: 'R101', longname: 'Room 101' }],
                lsnumber: 1
            }
        ];

        // Cycle 1+: The Math lesson is cancelled
        if (this.counter >= 1) {
            periods[0].code = 'cancelled';
        }
        
        // Cycle 2+: A new English lesson is added at 9:00
        if (this.counter >= 2) {
             periods.push({
                id: 1002,
                date: dateNum,
                startTime: 900,
                endTime: 945,
                kl: [{ id: 1, name: '10A', longname: '10A' }],
                te: [{ id: 2, name: 'TEST', longname: 'Test Teacher' }],
                su: [{ id: 2, name: 'ENG', longname: 'English' }],
                ro: [{ id: 2, name: 'R102', longname: 'Room 102' }],
                lsnumber: 2,
                code: 'irregular',
                lstext: 'Extra Lesson'
             });
        }

        return periods;
    }

    async getExams(start: Date, end: Date): Promise<UntisExam[]> {
        // Cycle 3+: A new exam appears
        if (this.counter >= 3) {
             const now = new Date();
             const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
             return [{
                 id: 999,
                 examType: 'written',
                 name: 'Math Final',
                 studentClass: ['10A'],
                 assignedStudents: [],
                 examDate: parseInt(dateStr),
                 startTime: 1000,
                 endTime: 1200,
                 subject: 'MATH',
                 teachers: ['MUSTER'],
                 rooms: ['R101'],
                 text: 'Final Exam'
             }];
        }
        return [];
    }

    async getAbsences(start: Date, end: Date): Promise<UntisAbsenceResponse> {
        return {
            absences: [],
            absenceReasons: [],
            excuseStatuses: {},
            showAbsenceReasonChange: false,
            showCreateAbsence: false
        };
    }

    async getNews(date: Date): Promise<UntisNewsWidget> {
        return { messagesOfDay: [] };
    }
}
