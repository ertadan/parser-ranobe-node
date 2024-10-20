const fs = require('fs');
const path = require('path');
const winston = require('winston');
const puppeteer = require('puppeteer');

const SAVED_CHAPTERS = path.join(__dirname, 'chapters.json');

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


async function saveChaptersToFile(chapters) {
    fs.writeFileSync(SAVED_CHAPTERS, JSON.stringify(chapters, null, 2), 'utf-8');
}

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
        await page.waitForSelector('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-header > div', { visible: true, timeout: 15000 });

        const headerText = await page.evaluate(() => {
            const header = document.querySelector('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-header > div');
            return header ? header.textContent : null;
        });

        if (headerText === 'Внимание') {
            logger.info('Найдено всплывающее окно с заголовком: ' + headerText);

            await page.click('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-body > div.form-group._offset > label > input');
            logger.info("Чекбокс о контенте для взрослых установлен");

            await page.click('body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-body > div.flex.btns._stretch > button.btn.is-filled.variant-primary.size-lg');
            logger.info('Нажата кнопка "Мне есть 18+"');

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

    const chapters = {};
    const scrollPauseTime = 2000; // Увеличьте время ожидания после прокрутки
    const scrollIncrement = 350; // Увеличение прокрутки

    let currentHeight = 0;
    let scrollHeight = await page.evaluate('document.body.scrollHeight');

    // Проверка элементов сразу после обработки окна
    await new Promise(resolve => setTimeout(resolve, 2000)); // Подождите 2 секунды
    const itemCount = await page.evaluate(() => document.querySelectorAll('.zx_a9').length);
    logger.info(`Количество элементов с классом '.zx_a9': ${itemCount}`);

    while (currentHeight < scrollHeight) {
        // Прокрутка вниз
        await page.evaluate(scrollIncrement => {
            window.scrollBy(0, scrollIncrement);
        }, scrollIncrement);

        // Ожидание загрузки новых элементов
        await new Promise(resolve => setTimeout(resolve, scrollPauseTime));

        // Сбор глав
        const newChapters = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.vue-recycle-scroller__item-view a'));
            return items.map(item => ({
                title: item.textContent,
                link: item.href
            }));
        });

        logger.info('Новые главы: ' + JSON.stringify(newChapters)); // Отладочный лог

        newChapters.forEach(chapter => {
            if (chapter.title && !chapters[chapter.title]) {
                logger.info(`Добавление главы: ${chapter.title}`);
                logger.info(`Добавление ссылки: ${chapter.link}`);
                chapters[chapter.title] = chapter.link; // Добавляем главу в объект
            }
        });

        // Проверка высоты страницы после прокрутки
        scrollHeight = await page.evaluate('document.body.scrollHeight');
        currentHeight += scrollIncrement; // Обновляем текущую высоту
    }

    const chaptersArray = Object.entries(chapters).map(([title, link]) => ({ title, link }));

    logger.info('Ссылки на главы: ' + chaptersArray.map(chapter => `${chapter.link}: ${chapter.title}`).join(', '));

    // Сохранение в chapters.json
    fs.writeFileSync(SAVED_CHAPTERS, JSON.stringify(chaptersArray, null, 2));

    return chaptersArray; // Возвращаем массив глав
}

async function main() {
    const { username, password, mangaLink } = await readConfig();
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await login(page, username, password);
    
    let chapters;
    if (fs.existsSync(SAVED_CHAPTERS)) {
        logger.info('Файл chapters.json найден, загружаем главы из файла...');
        const data = fs.readFileSync(SAVED_CHAPTERS, 'utf-8');
        chapters = JSON.parse(data);
    } else {
        logger.info('Файл chapters.json не найден, извлекаем главы...');
        chapters = await getChapters(page, mangaLink);
    }
    

    // Логика для работы с главами (например, вывод в лог или другое)
    logger.info('Готовые главы: ' + JSON.stringify(chapters));

    await browser.close();
}


main().catch(error => {
    logger.error('Ошибка: ' + error.message);
});
