const { WebUntis } = require('webuntis');
require('dotenv').config();

const createUntisSession = () => {
    return new WebUntis(
        process.env.UNTIS_SCHOOL,
        process.env.UNTIS_USER,
        process.env.UNTIS_PASSWORD,
        process.env.UNTIS_SERVER,
        'UntisNodeBot/1.0'
    );
};

const main = async () => {
    const untis = createUntisSession();
    try {
        await untis.login();
        const schoolYear = await untis.getCurrentSchoolyear();
        console.log('School Year Object:', JSON.stringify(schoolYear, null, 2));
        
        const start = new Date(schoolYear.startDate);
        console.log('new Date(startDate):', start.toISOString());
        
        const converted = WebUntis.convertUntisDate(String(schoolYear.startDate));
        console.log('WebUntis.convertUntisDate(startDate):', converted.toISOString());

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await untis.logout();
    }
};

main();