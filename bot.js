const puppeteer = require('puppeteer');
const brain = require('brain.js');
const netData = require('./data/NET.json');
const CONFIG = require('./CONFIG.json');

const NET = new brain.NeuralNetwork();
NET.fromJSON(netData);

let totalBids = 0;

async function startBrowser() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    return { browser, page };
}


async function login() {
    console.log(`SOKKER BOT | START`);
    console.table({ ...CONFIG.bot, searchFor: CONFIG.bot.searchFor.join(' | ')});

    const { browser, page } = await startBrowser();
    await page.goto('http://sokker.org/');

    // await page.waitFor(1000);
    await page.click('#ilogin');
    await page.keyboard.type(CONFIG.auth.username);
    await page.click('#ipassword');
    await page.keyboard.type(CONFIG.auth.password);
    await page.click('.form-horizontal .btn.btn-primary');

    await page.waitFor(1000);

    console.log('SOKKER BOT | logged in...');

    for(let iteration = 1; iteration <= CONFIG.bot.pollingIterations; iteration++) {
        console.log('\x1b[36m%s\x1b[0m', 'SOKKER BOT | processPlayers ===> iteration', iteration);
        // await new Promise(resolve => setTimeout(resolve, 1000))
        await processPlayers(page);

        if(iteration +1 === CONFIG.bot.pollingIterations) continue;
        console.log('\x1b[36m%s\x1b[0m', 'SOKKER BOT | sleeping ' + CONFIG.bot.pollingInterval/1000/60 + ' minutes...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.bot.pollingInterval));
    }

    browser.close();
}


async function parsePlayers(page) {
    await page.goto('http://sokker.org/transferSearch/');

    return page.evaluate(()=> {
        return [...document.querySelectorAll('.playersList.row')].map($player => {
            const $skills = $player.querySelector('.skills');

            return {
                name: $player.querySelector('.h5 > a').innerText,
                link: 'http://sokker.org/' + $player.querySelector('.h5 > a').getAttribute('href'),
                age: +($player.querySelector('.h5').innerText.split(',')[1].replace( /^\D+/g, '')) / 100,

                stamina: +$skills.querySelectorAll('tr')[0].innerText.match(/\d/g)[0] / 100,
                keeper: +$skills.querySelectorAll('tr')[0].innerText.match(/\d/g)[1] / 100,
                pace: +$skills.querySelectorAll('tr')[1].innerText.match(/\d/g)[0] / 100,
                defender: +$skills.querySelectorAll('tr')[1].innerText.match(/\d/g)[1] / 100,
                technique: +$skills.querySelectorAll('tr')[2].innerText.match(/\d/g)[0] / 100,
                playmaker: +$skills.querySelectorAll('tr')[2].innerText.match(/\d/g)[1] / 100,
                passing: +$skills.querySelectorAll('tr')[3].innerText.match(/\d/g)[0] / 100,
                striker: +$skills.querySelectorAll('tr')[3].innerText.match(/\d/g)[1] / 100
            }
        })
    });
}


async function processPlayers(page) {
    const players = await parsePlayers(page);

    for(let player of players) {
        await page.goto(player.link);

        if(player.age*100 < CONFIG.bot.minAge) continue;
        if(player.age*100 > CONFIG.bot.maxAge) continue;

        const netOutput = NET.run(player);
        const playerEstimate = Math.max(...CONFIG.bot.searchFor.map(skillName => Math.round(netOutput[skillName] * 100))); // zł
        const playerMaxBid = playerEstimate * 100000;
        const playerCurrentBid = await page.evaluate(()=> +document.getElementById('player-bid-place').value); // zł
        const buyerName = await page.evaluate(()=> document.getElementById('player-bid-buyer').innerText);

        console.log('SOKKER BOT | ', player.name, player.age*100, ' | playerEstimate: ', playerEstimate, ' | currentBid: ', playerCurrentBid + 'zł');

        if(buyerName === 'Benelone FC') { console.log('\x1b[36m%s\x1b[0m', '   ===> buyer is Benelone'); continue; }
        if(buyerName === 'United Division') { console.log('\x1b[36m%s\x1b[0m', '   ===> buyer is United Division'); continue; }
        if(playerCurrentBid > playerMaxBid) { console.log('\x1b[33m%s\x1b[0m', '   ===> playerCurrentBid > playerMaxBid'); continue; }
        if(playerEstimate < CONFIG.bot.minSkillValue) { console.log('\x1b[33m%s\x1b[0m', '   ===> playerEstimate < CONFIG.bot.minSkillValue', playerEstimate); continue; }
        if(playerCurrentBid > CONFIG.bot.maxPrice) { console.log('\x1b[33m%s\x1b[0m', '  ===> playerCurrentBid > CONFIG.bot.maxPrice', playerCurrentBid + + 'zł'); continue; }
        if(totalBids > CONFIG.bot.maxBids) { console.log('\x1b[33m%s\x1b[0m', 'total bids limit reached'); continue; }

        await page.click('#player-bid-place-group .btn');
        console.log('\x1b[36m%s\x1b[0m', "   ====> BID DONE");

        console.table({
            link: player.link,
            playerEstimate,
            playerMaxBid,
            playerCurrentBid
        });

        totalBids +=1;
    }

    console.log('SOKKER BOT | "processPlayers" end')
}


(async () => {
    await login();
    process.exit(1);
})();