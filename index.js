const puppeteer = require('puppeteer');
const fs = require('fs');
const winston = require('winston');

// Настройка логировщика
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' }),
    ],
});

async function readConfig() {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    return {
        username: config.username,
        password: config.password,
        mangaLink: config.mangaLink
    };
}

async function login(page, username, password) {
    logger.info('Вход в систему...');
    
    await page.goto('https://v2.slashlib.me/ru/front/auth', { waitUntil: 'networkidle2' });
    
    await page.waitForSelector('input[name="login"]', { visible: true });
    await page.type('input[name="login"]', username);
    
    await page.waitForSelector('input[name="password"]', { visible: true });
    await page.type('input[name="password"]', password);
    
    await Promise.all([
        page.click('button.btn.btn_variant-primary.btn_filled.btn_block.btn_size-lg[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
    ]);

    await page.waitForSelector('button.btn:nth-child(5)', { visible: true });
    await page.click('button.btn:nth-child(5)');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    logger.info('Успешно авторизован!');
}

async function handlePopup(page) {
    logger.info('Обработка всплывающего окна...');
    try {
        // Ждем, пока всплывающее окно станет видимым
        await page.waitForSelector('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-header > div', { visible: true, timeout: 15000 });

        // Проверяем текст в заголовке
        const headerText = await page.evaluate(() => {
            const header = document.querySelector('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-header > div');
            return header ? header.textContent : null;
        });

        if (headerText === 'Внимание') {
            logger.info('Найдено всплывающее окно с заголовком: ' + headerText);

            // Устанавливаем чекбокс о контенте для взрослых
            await page.click('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-body > div.form-group._offset > label > input');
            logger.info("Чекбокс о контенте для взрослых установлен");

            // Нажимаем на кнопку "Мне есть 18+"
            await page.click('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-body > div.flex.btns._stretch > button.btn.is-filled.variant-primary.size-lg');
            logger.info('Нажата кнопка "Мне есть 18+"');

            // Ждем навигации после нажатия кнопки
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            logger.info('Всплывающее окно обработано!');
        } else {
            logger.info('Всплывающее окно не найдено или текст отличается: ' + headerText);
        }
    } catch (error) {
        logger.error('Ошибка при обработке всплывающего окна: ' + error.message);
    }
}


async function getChapters(page, mangaLink) {
    logger.info('Извлечение глав...');
    
    const chaptersUrl = `${mangaLink}?section=chapters`;
    await page.goto(chaptersUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    await handlePopup(page); // Обработка всплывающего окна

    const chapters = await page.evaluate(() => {
        const chapterElements = document.querySelectorAll('.chapter-link'); // Замените на правильный селектор
        return Array.from(chapterElements).map(element => element.href);
    });

    logger.info('Ссылки на главы: ' + chapters.join(', '));
    return chapters;
}

async function main() {
    const { username, password, mangaLink } = await readConfig();
    
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await login(page, username, password);
    await getChapters(page, mangaLink);

    await browser.close();
}

main().catch(error => {
    logger.error('Ошибка: ' + error.message);
});
