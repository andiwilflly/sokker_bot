const fs = require('fs');
const puppeteer = require('puppeteer');
const log = require('node-pretty-log');
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

    log('success', 'logged in...');

    for(let iteration = 1; iteration <= CONFIG.bot.pollingIterations; iteration++) {
        log('info', 'processPlayers ===> iteration', iteration);
        // await new Promise(resolve => setTimeout(resolve, 1000))
        await processPlayers(page);

        if(iteration +1 === CONFIG.bot.pollingIterations) continue;
        log('info', 'sleeping ' + CONFIG.bot.pollingInterval/1000/60 + ' minutes...');
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
                age: +($player.querySelector('.h5').innerText.split(',')[1].replace( /^\D+/g, '')),

                stamina: +$skills.querySelectorAll('tr')[0].children[0].innerText.replace( /\D+/g, ''),
                keeper: +$skills.querySelectorAll('tr')[0].children[1].innerText.replace( /\D+/g, ''),
                pace: +$skills.querySelectorAll('tr')[1].children[0].innerText.replace( /\D+/g, ''),
                defender: +$skills.querySelectorAll('tr')[1].children[1].innerText.replace( /\D+/g, ''),
                technique: +$skills.querySelectorAll('tr')[2].children[0].innerText.replace( /\D+/g, ''),
                playmaker: +$skills.querySelectorAll('tr')[2].children[1].innerText.replace( /\D+/g, ''),
                passing: +$skills.querySelectorAll('tr')[3].children[0].innerText.replace( /\D+/g, ''),
                striker: +$skills.querySelectorAll('tr')[3].children[1].innerText.replace( /\D+/g, '')
            }
        })
    });
}


async function processPlayers(page) {
    const players = await parsePlayers(page);

    for(let player of players) {
        await page.goto(player.link);

        if(player.age < CONFIG.bot.minAge) continue;
        if(player.age > CONFIG.bot.maxAge) continue;

        const netOutput = NET.run({
            age: player.age / 100,
            stamina: player.stamina / 100,
            keeper:player.keeper / 100,
            pace: player.pace / 100,
            defender: player.defender / 100,
            technique: player.technique / 100,
            playmaker: player.playmaker / 100,
            passing: player.passing / 100,
            striker: player.striker / 100
        });
        let playerEstimate = Math.max(...CONFIG.bot.searchFor.map(skillName => Math.round(netOutput[skillName] * 100))); // zł
        playerEstimate =  Math.round(playerEstimate * 1.6); // uah

        let playerCurrentBid = await page.evaluate(()=> +document.getElementById('player-bid-place').value); // zł
        playerCurrentBid = Math.round(playerCurrentBid * 1.6); // uah

        const playerMaxBid = playerEstimate * 100000;
        const buyerName = await page.evaluate(()=> document.getElementById('player-bid-buyer').innerText);

        const fields = { ...player };
        delete fields.link;
        console.table([{ playerCurrentBid, playerEstimate, ...netOutput }]);

        if(buyerName === 'Benelone FC') { log('warn', 'buyer is Benelone'); continue; }
        if(buyerName === 'United Division') { log('warn', 'buyer is United Division'); continue; }
        if(playerCurrentBid > playerMaxBid) { log('warn', 'playerCurrentBid > playerMaxBid'); continue; }
        if(playerEstimate < CONFIG.bot.minSkillValue) { log('warn', 'playerEstimate < CONFIG.bot.minSkillValue', playerEstimate, '<', CONFIG.bot.minSkillValue); continue; }
        if(playerCurrentBid > CONFIG.bot.maxPrice) { log('warn', 'playerCurrentBid > CONFIG.bot.maxPrice', playerCurrentBid + 'zł > ', CONFIG.bot.maxPrice + 'zł'); continue; }
        if(totalBids > CONFIG.bot.maxBids) { log('warn', 'total bids limit reached'); continue; }

        await page.click('#player-bid-place-group .btn');
        const myBid = await page.evaluate(()=> +document.getElementById('player-bid-place').value);

        log('success', "BID DONE");
        fs.appendFile('./data/log.txt', `${new Date().toLocaleString()} | BID DONE | ${player.name} | ${myBid} zł | ${player.link} \n`, (err)=> {
            if (err) throw err;
        });

        console.table({
            link: player.link,
            playerEstimate,
            playerMaxBid,
            playerCurrentBid
        });

        totalBids +=1;

        console.log(' ------------------------------------------------------------------------------------------------------------------------------------------------------ ');
        console.log(' ');
    }

    log('info', '"processPlayers" end')
}


(async () => {
    await login();
    process.exit(1);
})();