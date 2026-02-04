const express = require('express');
const cheerio = require('cheerio');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const BASE_URL = 'https://www.visioncine-1.com.br';

// Configuração aprimorada do axios para evitar bloqueios
const axiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Referer': BASE_URL
    }
});

// Interceptor para lidar com cookies automaticamente
axiosInstance.interceptors.response.use(
    response => {
        // Armazena cookies recebidos
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            const cookies = setCookie.map(cookie => cookie.split(';')[0]).join('; ');
            axiosInstance.defaults.headers.Cookie = cookies;
        }
        return response;
    },
    error => {
        if (error.response?.status === 403) {
            console.error('❌ Erro 403: Acesso bloqueado pelo site');
            console.log('💡 Dica: O site pode estar bloqueando requisições automatizadas');
        }
        return Promise.reject(error);
    }
);

// Função para fazer requests com retry e delay
async function makeRequest(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            // Pequeno delay entre requisições
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 2000 * i));
            }
            
            console.log(`📡 Fazendo requisição para: ${url}`);
            const response = await axiosInstance.get(url);
            console.log(`✅ Requisição bem-sucedida (${response.status})`);
            return response.data;
        } catch (error) {
            console.error(`❌ Tentativa ${i + 1}/${retries} falhou:`, error.message);
            
            if (error.response?.status === 403) {
                console.log('🔒 Erro 403 detectado - Site bloqueou a requisição');
            }
            
            if (i === retries - 1) throw error;
        }
    }
}

// Extrair dados de um item
function extractItemData($, element) {
    const $item = $(element);
    const $info = $item.find('.info');
    
    const title = $info.find('h6').text().trim();
    const image = $item.find('.content').css('background-image')
        ?.replace(/url\(['"]?/, '')
        .replace(/['"]?\)/, '');
    
    const tags = $info.find('.tags span').map((i, el) => $(el).text().trim()).get();
    const link = $info.find('a[href*="/watch/"]').attr('href');
    
    return {
        title,
        image,
        duration: tags[0] || '',
        year: tags[1] || '',
        imdb: tags[2]?.replace('IMDb', '').trim() || '',
        link: link ? `${BASE_URL}${link}` : '',
        slug: link?.split('/watch/')[1] || ''
    };
}

// Rota: Página inicial
app.get('/api/home', async (req, res) => {
    try {
        const html = await makeRequest(BASE_URL);
        const $ = cheerio.load(html);
        
        const categories = [];
        
        $('.front').each((i, section) => {
            const $section = $(section);
            const categoryName = $section.find('h5').text().trim();
            const items = [];
            
            $section.find('.swiper-slide.item').each((j, item) => {
                items.push(extractItemData($, item));
            });
            
            if (categoryName && items.length > 0) {
                categories.push({
                    name: categoryName,
                    items
                });
            }
        });
        
        res.json({ success: true, categories, timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            statusCode: error.response?.status,
            hint: error.response?.status === 403 ? 'Site bloqueou a requisição. Verifique se precisa de autenticação ou se há proteção anti-bot.' : null
        });
    }
});

// Rota: Buscar conteúdo
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
        }
        
        const html = await makeRequest(`${BASE_URL}/search.php?q=${encodeURIComponent(q)}`);
        const $ = cheerio.load(html);
        
        const results = [];
        $('.item.poster').each((i, item) => {
            results.push(extractItemData($, item));
        });
        
        res.json({ success: true, query: q, results, count: results.length });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            statusCode: error.response?.status 
        });
    }
});

// Rota: Obter detalhes e link do vídeo
app.get('/api/video/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const watchUrl = `${BASE_URL}/watch/${slug}`;
        
        const html = await makeRequest(watchUrl);
        const $ = cheerio.load(html);
        
        // Extrair link do player
        const playerLink = $('a[href*="playcnvs.stream"]').attr('href') || 
                          $('a[href*="ASSISTIR"]').attr('href') ||
                          $('iframe').attr('src');
        
        if (!playerLink) {
            return res.status(404).json({ success: false, error: 'Player link not found' });
        }
        
        // Tentar extrair URL do vídeo
        let videoUrl = null;
        try {
            const playerHtml = await makeRequest(playerLink);
            const $player = cheerio.load(playerHtml);
            
            videoUrl = $player('video source').attr('src') || 
                      $player('video').attr('src') ||
                      $player('iframe').attr('src');
        } catch (err) {
            console.log('⚠️  Não foi possível acessar o player diretamente');
        }
        
        res.json({ 
            success: true, 
            playerLink,
            videoUrl,
            slug,
            note: videoUrl ? null : 'Video URL may require additional authentication'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            statusCode: error.response?.status 
        });
    }
});

// Rota: Filmes
app.get('/api/movies', async (req, res) => {
    try {
        const html = await makeRequest(`${BASE_URL}/movies`);
        const $ = cheerio.load(html);
        
        const movies = [];
        $('.item.poster').each((i, item) => {
            movies.push(extractItemData($, item));
        });
        
        res.json({ success: true, movies, count: movies.length });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            statusCode: error.response?.status 
        });
    }
});

// Rota: Séries
app.get('/api/series', async (req, res) => {
    try {
        const html = await makeRequest(`${BASE_URL}/tvseries`);
        const $ = cheerio.load(html);
        
        const series = [];
        $('.item.poster').each((i, item) => {
            series.push(extractItemData($, item));
        });
        
        res.json({ success: true, series, count: series.length });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            statusCode: error.response?.status 
        });
    }
});

// Rota: Animes
app.get('/api/animes', async (req, res) => {
    try {
        const html = await makeRequest(`${BASE_URL}/animes`);
        const $ = cheerio.load(html);
        
        const animes = [];
        $('.item.poster').each((i, item) => {
            animes.push(extractItemData($, item));
        });
        
        res.json({ success: true, animes, count: animes.length });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            statusCode: error.response?.status 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Rota de teste para verificar conectividade
app.get('/api/test', async (req, res) => {
    try {
        console.log('🧪 Testando conexão com o site...');
        const response = await axiosInstance.get(BASE_URL);
        res.json({
            success: true,
            status: response.status,
            message: 'Conexão bem-sucedida!',
            headers: response.headers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            statusCode: error.response?.status,
            headers: error.response?.headers
        });
    }
});

// Menu de rotas
app.get('/', (req, res) => {
    res.json({
        message: '🎬 VisionCine API',
        version: '2.0',
        routes: {
            health: '/health',
            test: '/api/test',
            home: '/api/home',
            search: '/api/search?q=nome_do_filme',
            video: '/api/video/:slug',
            movies: '/api/movies',
            series: '/api/series',
            animes: '/api/animes'
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`==> Seu serviço está online 🎉`);
    console.log(`Menu`);
    console.log(`==> `);
    console.log(`==> ///////////////////////////////////////////////////////////`);
    console.log(`==> `);
    console.log(`==> Disponível no seu URL principal : https://api-falfsasa.onrender.com`);
    console.log(`==> `);
    console.log(`==> ///////////////////////////////////////////////////////////`);
});
