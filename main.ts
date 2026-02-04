import { Store } from './src/store.js';
import { UntisManager } from './src/untis-manager.js';
import { MockUntisManager } from './src/mock-untis-manager.js';
import { FeedGenerator } from './src/feed-generator.js';
import { startServer } from './src/server.js';
import { config } from './src/config.js';

const main = async () => {
    const store = new Store();
    await store.init();

    const isMock = process.argv.includes('--mock');
    const untisManager = isMock ? new MockUntisManager() : new UntisManager();
    const feedGenerator = new FeedGenerator(store, untisManager);

    // Initial update
    await feedGenerator.update();
    
    // Schedule updates
    setInterval(() => feedGenerator.update(), config.updateInterval);

    // Check for --dev flag to enable manual refresh
    if (process.argv.includes('--dev')) {
        console.log('Development mode enabled. Press "r" to manually refresh the feed.');
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.on('data', async (key) => {
            if (key === 'r' || key === 'R') {
                console.log('\nManual refresh triggered...');
                await feedGenerator.update();
            } else if (key === '\u0003') { // Ctrl+C
                console.log('\nExiting application.');
                process.exit();
            }
        });
    }

    await startServer();
};

main().catch(error => {
    console.error("Critical error in main execution:", error);
    process.exit(1);
});
