import { promises as fs } from 'fs';
import { config } from './config.js';
import { State, TimetableCache, FeedItem } from './types.js';

export class Store {
    private state: State = { seen: [], history: [] };

    async init(): Promise<void> {
        try {
            await fs.mkdir(config.dataDir, { recursive: true });
        } catch (error) {
            console.error("Could not create data directory:", error);
        }
        await this.loadState();
    }

    private async loadState(): Promise<void> {
        try {
            const data = await fs.readFile(config.stateFile, 'utf8');
            this.state = JSON.parse(data);
            if (!Array.isArray(this.state.seen)) {
                this.state.seen = [];
            }
            if (!Array.isArray(this.state.history)) {
                this.state.history = [];
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                console.log('No state file found, starting fresh.');
                this.state = { seen: [], history: [] };
            } else {
                console.error('Error loading state:', error);
            }
        }
    }

    async saveState(): Promise<void> {
        try {
            await fs.writeFile(config.stateFile, JSON.stringify(this.state, null, 2));
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    isSeen(uid: string): boolean {
        return this.state.seen.includes(uid);
    }

    markSeen(uid: string): void {
        this.state.seen.push(uid);
    }

    addToHistory(item: FeedItem): void {
        this.state.history.push(item);
    }

    getHistory(): FeedItem[] {
        return this.state.history;
    }

    pruneHistory(maxAgeMs: number): void {
        const now = new Date().getTime();
        this.state.history = this.state.history.filter(item => {
            const itemTime = new Date(item.date).getTime();
            return (now - itemTime) < maxAgeMs;
        });
    }

    async loadTimetableCache(): Promise<TimetableCache | null> {
        try {
            const data = await fs.readFile(config.timetableCacheFile, 'utf8');
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    async saveTimetableCache(snapshot: TimetableCache): Promise<void> {
        try {
            await fs.writeFile(config.timetableCacheFile, JSON.stringify(snapshot, null, 2));
        } catch (error) {
            console.error('Error saving timetable cache:', error);
        }
    }
}
