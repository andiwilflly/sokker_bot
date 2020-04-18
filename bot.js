const fs = require('fs');
const puppeteer = require('puppeteer');
const brain = require('brain.js');
const netData = require('./data/NET.json');
const _CONFIG = require('./CONFIG.json');

const NET = new brain.NeuralNetwork();
NET.fromJSON(netData);

let totalBids = 0;

async function startBrowser() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    return { browser, page };
}

let STATUS = 'initial';

function stop(CLIENT) {
    if(STATUS === 'stop') return;
    STATUS = 'stop';
    CLIENT.emit('terminal', { name: `<div style="color: red">ERROR</div>`, details: 'STOPPING BOT...' });
}

async function login(CLIENT, clientConfig) {
    const CONFIG = Object.assign(_CONFIG, { bot: clientConfig });

    console.log(CONFIG);

    if(STATUS === 'start') return CLIENT.emit('terminal', { name: `<div style="color: red">ERROR</div>`, details: 'BOT STOPPED' });
    STATUS = 'start';

    CLIENT.emit('terminal', { name: `<div style="color: green">SUCCESS</div>`, details: 'BOT STARTED' });

    const { browser, page } = await startBrowser();
    await page.goto('http://sokker.org/');

    CLIENT.emit('terminal', { name: `<div style="color: green">SUCCESS</div>`, details: 'Logging in to sokker.org...' });

    // await page.waitFor(1000);
    await page.click('#ilogin');
    await page.keyboard.type(CONFIG.auth.username);
    await page.click('#ipassword');
    await page.keyboard.type(CONFIG.auth.password);
    await page.click('.form-horizontal .btn.btn-primary');

    await page.waitFor(1000);

    CLIENT.emit('terminal', { name: `<div style="color: green">SUCCESS</div>`, details: "Logged in to sokker.org" });

    for(let iteration = 1; iteration <= CONFIG.bot.pollingIterations; iteration++) {
        console.log('processPlayers... iteration: ', iteration);

        CLIENT.emit('terminal', { name: `<div style="color: lightskyblue">INFO</div>`, details: `Iteration: ${iteration} (STATUS: ${STATUS})` });

        // await new Promise(resolve => setTimeout(resolve, 1000))
        await processPlayers(page, CLIENT, CONFIG);

        if(STATUS === 'stop') {
            CLIENT.emit('terminal', { name: `<div style="color: red">ERROR</div>`, details: 'BOT STOPPED' });
            break;
        }

        if(iteration +1 === CONFIG.bot.pollingIterations) continue;

        CLIENT.emit('terminal', { name: `<div style="color: lightskyblue">INFO</div>`, details: 'sleeping ' + CONFIG.bot.pollingInterval/1000/60 + ' minutes...' });
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


async function processPlayers(page, CLIENT, CONFIG) {
    const players = await parsePlayers(page);

    for(let player of players) {
        if(STATUS === 'stop') return;
        await page.goto(player.link);

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
        const playerEstimate = Math.max(...CONFIG.bot.searchFor.map(skillName => Math.round(netOutput[skillName] * 100)));

        let playerCurrentBid = await page.evaluate(()=> +document.getElementById('player-bid-place').value); // uah
        playerCurrentBid = Math.round(playerCurrentBid); // uah

        const playerMaxBid = playerEstimate * 100000;
        const buyerName = await page.evaluate(()=> document.getElementById('player-bid-buyer').innerText);

        const fields = { ...player };
        delete fields.link;

        if(STATUS === 'stop') return;
        CLIENT.emit('terminal', { name: `<div style="color: lightskyblue">PLAYER</div>`, details: `<a href="${player.link}" target="_blank">${player.name}, ${player.age}</a>` });
        CLIENT.emit('terminal', {
            name: `<div style="color: lightskyblue">INFO</div>`,
            details: `<table>
                <tr>
                    <td>playerCurrentBid</td>
                    <td>playerEstimate</td>
                    <td>${Object.keys(netOutput)[0]}</td>
                    <td>${Object.keys(netOutput)[1]}</td>
                    <td>${Object.keys(netOutput)[2]}</td>
                    <td>${Object.keys(netOutput)[3]}</td>
                </tr>
                <tr>
                    <td>${playerCurrentBid} UAH</td>
                    <td>${playerEstimate}</td>
                    <td>${Object.values(netOutput)[0]}</td>
                    <td>${Object.values(netOutput)[1]}</td>
                    <td>${Object.values(netOutput)[2]}</td>
                    <td>${Object.values(netOutput)[3]}</td>
                </tr>
            </table>`
        });

        await page.waitFor(700);

        // CONFIG filtration
        if(player.age < CONFIG.bot.minAge)            { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'player.age < CONFIG.bot.minAge' }); continue; }
        if(player.age > CONFIG.bot.maxAge)            { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'player.age > CONFIG.bot.maxAge' }); continue; }
        if(buyerName === 'Benelone FC')               { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'buyer is Benelone' }); continue; }
        if(buyerName === 'United Division')           { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'buyer is United Division' }); continue; }
        if(playerCurrentBid > playerMaxBid)           { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'playerCurrentBid > playerMaxBid' }); continue; }
        if(playerEstimate < CONFIG.bot.minSkillValue) { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'playerEstimate < CONFIG.bot.minSkillValue ' + playerEstimate + ' < ' + CONFIG.bot.minSkillValue }); continue; }
        if(playerCurrentBid > CONFIG.bot.maxPrice)    { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: playerCurrentBid + ' UAH > ' + CONFIG.bot.maxPrice + ' UAH' }); continue; }
        if(totalBids > CONFIG.bot.maxBids)            { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'total bids limit reached' }); continue; }

        // Skills filtration
        if(CONFIG.bot.stamina && CONFIG.bot.stamina > player.stamina)       { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'stamina: ' + CONFIG.bot.stamina + ' > ' + player.stamina }); continue; }
        if(CONFIG.bot.keeper && CONFIG.bot.keeper > player.keeper)          { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'keeper: ' + CONFIG.bot.keeper + ' > ' + player.keeper }); continue; }
        if(CONFIG.bot.pace && CONFIG.bot.pace > player.pace)                { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'pace: ' + CONFIG.bot.pace + ' > ' + player.pace }); continue; }
        if(CONFIG.bot.defender && CONFIG.bot.defender > player.defender)    { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'defender: ' + CONFIG.bot.defender + ' > ' + player.defender }); continue; }
        if(CONFIG.bot.technique && CONFIG.bot.technique > player.technique) { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'technique: ' + CONFIG.bot.technique + ' > ' + player.technique }); continue; }
        if(CONFIG.bot.playmaker && CONFIG.bot.playmaker > player.playmaker) { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'playmaker: ' + CONFIG.bot.playmaker + ' > ' + player.playmaker }); continue; }
        if(CONFIG.bot.passing && CONFIG.bot.passing > player.passing)       { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'passing: ' + CONFIG.bot.passing + ' > ' + player.passing }); continue; }
        if(CONFIG.bot.striker && CONFIG.bot.striker > player.striker)       { CLIENT.emit('terminal', { name: `<div style="color: orange">WARN</div>`, details: 'striker: ' + CONFIG.bot.striker + ' > ' + player.striker }); continue; }


        await page.click('#player-bid-place-group .btn');

        const isNeedAcceptBid = await page.evaluate(()=> document.querySelector('.list-inline.list-prefix-raquo a'));

        if(isNeedAcceptBid) {
            CLIENT.emit('terminal', { name: `<div style="color: red">ERROR</div>`, details: 'BID NOT DONE, need to accept bid' });
            continue;
        }

        CLIENT.emit('terminal', { name: `<div style="color: green">SUCCESS</div>`, details: `BID DONE | ${player.name} | ${playerCurrentBid} uah | ${player.link} | skill: ${playerEstimate}` });


        CLIENT.emit('terminal', {
            name: `<div style="color: lightskyblue">INFO</div>`,
            details: `<table>
                <tr>
                    <td>link</td>
                    <td>playerEstimate</td>
                    <td>playerMaxBid</td>
                    <td>playerCurrentBid</td>
                </tr>
                <tr>
                    <td><a href="${player.link}" target="_blank">${player.name}</a></td>
                    <td>${playerEstimate}</td>
                    <td>${playerMaxBid} UAH</td>
                    <td>${playerCurrentBid} UAH</td>
                </tr>
            </table>`
        });

        totalBids +=1;
    }

    CLIENT.emit('terminal', { name: `<div style="color: lightskyblue">INFO</div>`, details: '"processPlayers" end' });
}


module.exports = {
    start: login,
    stop
};
