export interface FeedItem {
    title: string;
    id: string;
    link: string;
    description: string;
    date: string; // ISO string
}

export interface State {
    seen: string[];
    history: FeedItem[];
}

export interface PeriodEntry {
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

export interface TimetableCache {
    [key: string]: PeriodEntry;
}

export interface Change {
    type: 'added' | 'removed' | 'updated';
    old?: PeriodEntry;
    new?: PeriodEntry;
}

// --- WebUntis API Interfaces ---

export interface UntisEntity {
    id: number;
    name: string;
    longname: string;
}

export interface UntisTeacher extends UntisEntity {
    orgid?: number;
    orgname?: string;
}

export interface UntisPeriod {
    id: number;
    date: number; // YYYYMMDD
    startTime: number; // HHMM
    endTime: number; // HHMM
    kl: UntisEntity[]; // Classes
    te: UntisTeacher[]; // Teachers
    su: UntisEntity[]; // Subjects
    ro: UntisEntity[]; // Rooms
    lsnumber: number;
    activityType?: string;
    code?: 'cancelled' | 'irregular' | string;
    substText?: string;
    lstext?: string;
    sg?: string; // Subject group
    bkRemark?: string;
}

export interface UntisExam {
    id: number;
    examType: string;
    name: string;
    studentClass: string[];
    assignedStudents: {
        id: number;
        displayName: string;
        // ... other fields omitted for brevity
    }[];
    examDate: number; // YYYYMMDD
    startTime: number; // HHMM
    endTime: number; // HHMM
    subject: string;
    teachers: string[]; // Array of teacher short names (strings)
    rooms: string[]; // Array of room names (strings)
    text: string;
}

export interface UntisExcuse {
    id: number;
    text: string;
    excuseDate: number; // YYYYMMDD
    excuseStatus: string;
    isExcused: boolean;
    userId: number;
    username: string;
}

export interface UntisAbsence {
    id: number;
    startDate: number; // YYYYMMDD
    endDate: number; // YYYYMMDD
    startTime: number; // HHMM
    endTime: number; // HHMM
    createDate: number; // Timestamp
    lastUpdate: number; // Timestamp
    createdUser: string;
    updatedUser: string;
    reasonId: number;
    reason: string;
    text: string;
    interruptions: any[];
    canEdit: boolean;
    studentName: string;
    excuseStatus: string;
    isExcused: boolean;
    excuse?: UntisExcuse;
}

export interface UntisAbsenceResponse {
    absences: UntisAbsence[];
    absenceReasons: any[];
    excuseStatuses: any;
    showAbsenceReasonChange: boolean;
    showCreateAbsence: boolean;
}

export interface UntisMessage {
    id: number;
    subject: string;
    text: string;
    // Add other fields if known, otherwise these are the critical ones
}

export interface UntisNewsWidget {
    messagesOfDay: UntisMessage[];
}
