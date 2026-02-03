import { Store } from './src/store.js';
import { UntisManager } from './src/untis-manager.js';
import { FeedGenerator } from './src/feed-generator.js';
import { startServer } from './src/server.js';
import { config } from './src/config.js';

const main = async () => {
    const store = new Store();
    await store.init();

    const untisManager = new UntisManager();
    const feedGenerator = new FeedGenerator(store, untisManager);

    // Initial update
    await feedGenerator.update();
    
    // Schedule updates
    setInterval(() => feedGenerator.update(), config.updateInterval);

    await startServer();
};

main().catch(error => {
    console.error("Critical error in main execution:", error);
    process.exit(1);
});
