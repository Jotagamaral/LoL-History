// server.js
const http = require('http');
const { parse } = require('querystring');
const fs = require('fs');
const cheerio = require('cheerio');
const EventEmitter = require('events');
const { Console, error } = require('console');

const eventEmitter = new EventEmitter();

// Dados para envio da requisição
const API_KEY = "RGAPI-6d85b4a5-7ec7-43bd-9ef2-c79036c4c99e"
const API_BASE_URL = "https://americas.api.riotgames.com";

let elo = ''
let division = ''
let summonerId = ''
let mediaKda = 0
let notinha = 0

head = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Charset": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://developer.riotgames.com",
    "x-riot-token": API_KEY // Chave gerada pela Riot
}

// Função de requisição da Api Riot Games
async function apiRequest(url) {
    try {
        const response = await fetch(url, { headers: head });
        return response.json()
    } catch (error) {
        console.error('Erro durante a requisição da API:', error)
        throw error
    }
}

// Cálculo da Nota
function calculateScore(elo, division, mediaKda) {
    const scoreTable = {
        'IRON': 0,
        'BRONZE': 20,
        'SILVER': 40,
        'GOLD': 60,
        'PLATINUM': 65,
        'EMERALD': 70,
        'DIAMOND': 75
    };

    const eloScore = scoreTable[elo] || 0;
    const divisionScore = division === 'I' ? 3 : (division === 'II' ? 2 : (division === 'III' ? 1 : 0));
    return Math.floor(eloScore + divisionScore + mediaKda);
}

// Obter informações do player
async function getPlayerData(matches, puuid, summonerId) {
    const playerData = {
        championName: [],
        kill: [],
        death: [],
        assist: [],
        killDeathAssist: [],
        summonerId: ''
    };

    const promises = matches.map(async element => {
        const urlIdMatch = `${API_BASE_URL}/lol/match/v5/matches/${element}`;
        return apiRequest(urlIdMatch);
    });
    
    const matchDatas = await Promise.all(promises);

    matchDatas.forEach(matchData => { 
        const participants = matchData.info.participants;   
        for(const player of participants) {   
            if (player.puuid === puuid) {
                playerData.championName.push(player.championName);
                playerData.kill.push(player.kills);
                playerData.death.push(player.deaths);
                playerData.assist.push(player.assists);
                playerData.killDeathAssist.push(parseFloat(player.challenges.kda.toFixed(2)));
                if (!summonerId) playerData.summonerId = player.summonerId;
            }
        }
    });
    return playerData;
}

// Função atualizar o arquivo HTML com os dados recebidos
function htmlUpdate(data) {
    try {
        const html = fs.readFileSync('carta_page.html', 'utf8');
        const $ = cheerio.load(html);
        $('#nomeJogador').text(`${data.gameName}`);
        $('#regiaoJogador').text(`${data.tagLine}`);
        fs.writeFileSync('carta_page.html', $.html());
        return true

    } catch (error) {
        console.log('Erro ao atualizar a página:', error)
        throw error
    }
}

// Redirecionar o usuário para carta_page.html
function redirectTo(res, update, erro) {
    const location = update ? 'carta_page.html' : `index.html?erro=${erro}`; // Adiciona o parâmetro de erro na URL
    res.writeHead(302, { 'Location': `http://127.0.0.1:5500/LoL-History/${location}` });
    res.end();  
}

function redirectToReload(res) {
    res.writeHead(302, { 'Location': 'http://127.0.0.1:5500/index.html' });
    res.end();  
}


// Criação do Servidor
async function handleRequest(req, res) {

    if (req.method === 'POST' || req.url === '/receber-dados') {
        let body = '';

        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const formData = parse(body);
            const { nome, regiao } = formData;
            const urlpuuid = `${API_BASE_URL}/riot/account/v1/accounts/by-riot-id/${nome}/${regiao}`;
            
            try {
                const data = await apiRequest(urlpuuid); // Função da Api - GET Puuid

                if (data.status) {
                    console.log('ENTROUUUUUUUUUUUUU')
                    redirectToReload(res)   
                }
               
                const puuid = data.puuid;
                
                const urlMatch = `${API_BASE_URL}/lol/match/v5/matches/by-puuid/${puuid}/ids`;
                const matches = await apiRequest(urlMatch)  
                
                const update = htmlUpdate(data) // Atualiza o html
                redirectTo(res, update) // Redireciona o usuário

                const playerData = await getPlayerData(matches, puuid, summonerId);

                mediaKda = parseFloat((playerData.killDeathAssist.reduce((acc, curr) => {
                    return acc + curr;
                }, 0) / playerData.killDeathAssist.length).toFixed(2));
                console.log('Média de KDA:', mediaKda);
                
                const urlrank = `https://br1.api.riotgames.com/lol/league/v4/entries/by-summoner/${playerData.summonerId}`;
                const rank = await apiRequest(urlrank); // Função da Api Matches - GET Rank
                elo = rank[0].tier;
                division = rank[0].rank;
                
                console.log('Elo:', elo );
                console.log('Division:', division);

                notinha = calculateScore(elo, division, mediaKda);
                console.log('Nota:', notinha)

                playerDados = {
                    championName: playerData.championName,
                    kill: playerData.kill,
                    death: playerData.death,
                    assist: playerData.assist,
                    kda: playerData.killDeathAssist,
                    elo: elo,
                    division: division
                }

                console.log('Dados:',playerDados)

            } catch (error) {
                console.error('Erro durante o processamento:', error);
                res.statusCode = 500;
                res.end('Erro interno do servidor');
                }
        });
    }

    else if (req.url === '/sse') {
        // Configura a conexão SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

         // Envia uma mensagem de teste em intervalos regulares
        const intervalId = setInterval(() => {
            res.write(`data:${JSON.stringify(playerDados)}\n\n`);
        }, 5000); // Envia a cada 5 segundos

        // Define um limite de tempo para a execução do intervalo (por exemplo, 60 segundos)
        const timeoutId = setTimeout(() => {
            clearInterval(intervalId); // Limpa o intervalo após 60 segundos
            res.end(); // Fecha a conexão após o intervalo de tempo limite
        }, 11000); // 60 segundos em milissegundos
        
        // Fecha a conexão quando o cliente se desconectar
        req.on('close', () => {
            clearTimeout(timeoutId); // Limpa o timeout quando a conexão é fechada
            clearInterval(intervalId); // Limpa o intervalo quando a conexão é fechada
        });
    }

    else {
        res.statusCode = 404;
        res.end('Página não encontrada');
        return;
    }
} 

const server = http.createServer(handleRequest);
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://127.0.0.1:5500/${PORT}`);
});