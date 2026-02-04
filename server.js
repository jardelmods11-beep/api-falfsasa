const express = require('express');
const cheerio = require('cheerio');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Cookies para autenticação
const COOKIES = {
    '_ga': 'GA1.1.1028074587.1770204856',
    '_ga_W619E2HYE0': 'GS2.1.s1770204855$o1$g1$t1770205275$j55$l0$h0',
    'PHPSESSID': 'edn2nff52lvvbs3ms9htebgpr2'
};

const BASE_URL = 'https://www.visioncine-1.com.br';

// Configurar axios com cookies
const axiosInstance = axios.create({
    timeout: 30000,
    headers: {
        'Cookie': Object.entries(COOKIES).map(([key, value]) => `${key}=${value}`).join('; '),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Connection': 'keep-alive'
    }
});

// Função para fazer requests com axios
async function makeRequest(url) {
    try {
        const response = await axiosInstance.get(url);
        return response.data;
    } catch (error) {
        console.error('Erro ao fazer request:', error.message);
        throw error;
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

// Rota: Página inicial - Mais Visto do Dia
app.get('/api/home', async (req, res) => {
    try {
        const html = await makeRequest(BASE_URL);
        const $ = cheerio.load(html);
        
        const categories = [];
        
        // Extrair todas as categorias
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
        
        res.json({ success: true, categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rota: Buscar conteúdo
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Query parameter required' });
        }
        
        const html = await makeRequest(`${BASE_URL}/search.php?q=${encodeURIComponent(q)}`);
        const $ = cheerio.load(html);
        
        const results = [];
        $('.item.poster').each((i, item) => {
            results.push(extractItemData($, item));
        });
        
        res.json({ success: true, query: q, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
                          $('a[href*="ASSISTIR"]').attr('href');
        
        if (!playerLink) {
            return res.status(404).json({ success: false, error: 'Player link not found' });
        }
        
        // Fazer request no player para pegar o vídeo
        const playerHtml = await makeRequest(playerLink);
        const $player = cheerio.load(playerHtml);
        
        // Extrair URL do vídeo
        const videoUrl = $player('video source').attr('src') || 
                        $player('video').attr('src');
        
        if (!videoUrl) {
            return res.status(404).json({ success: false, error: 'Video URL not found' });
        }
        
        res.json({ 
            success: true, 
            videoUrl,
            playerLink,
            slug 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
        
        res.json({ success: true, movies });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
        
        res.json({ success: true, series });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
        
        res.json({ success: true, animes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
