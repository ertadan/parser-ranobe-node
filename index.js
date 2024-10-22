const fs = require('fs');
const path = require('path');
const winston = require('winston');
const puppeteer = require('puppeteer');

const SAVED_CHAPTERS = path.join(__dirname, 'chapters.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const POPUP_SELECTORS = {
    indexPage: {
        header: 'body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-header > div',
        checkbox: 'body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-body > div.form-group._offset > label > input',
        button: 'body > div.popup-root > div:nth-child(2) > div.popup__inner > div > div.popup-body > div.flex.btns._stretch > button.btn.is-filled.variant-primary.size-lg'
    },
    readerPage: {
        header: 'body > div.popup-root > div > div.popup__inner > div > div.popup-header > div',
        checkbox: 'body > div.popup-root > div > div.popup__inner > div > div.popup-body > div:nth-child(2) > label > input',
        button: 'body > div.popup-root > div > div.popup__inner > div > div.popup-body > div.btns._stretch > button.btn.variant-danger'
    }
};

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
    const retries = 3;
    const delay = 2000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
        logger.info('Вход в систему...');
        
        await page.goto('https://v2.slashlib.me/ru/front/auth', { waitUntil: 'networkidle2', timeout: 60000  });
        
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
        logger.info('Ожидаем окончания загрузки страницы...');
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
        logger.info('Успешно авторизован!');

        return; 
    } catch (error) {
        if (error.message.includes('net::ERR_CONNECTION_RESET') && attempt < retries) {
            logger.warn(`Попытка ${attempt} не удалась: ${error.message}. Повтор через ${delay / 1000} секунд...`);
            await new Promise(resolve => setTimeout(resolve, delay)); // Задержка перед следующей попыткой
        } else {
            logger.error('Ошибка при входе: ' + error.message);
            throw error; // Пробрасываем ошибку, если достигли лимита попыток или другая ошибка
            }
        }
    }
}

async function handlePopup(page, source) {
    logger.info('Обработка всплывающего окна...');
    try {
        await page.waitForSelector(source.header, { visible: true, timeout: 30000 });

        const headerText = await page.evaluate((headerSelector) => {
            const header = document.querySelector(headerSelector);
            return header ? header.textContent : null;
        }, source.header);

        if (headerText === 'Внимание' || headerText === 'Предупреждение') {
            logger.info('Найдено всплывающее окно с заголовком: ' + headerText);

            await page.click(source.checkbox);
            logger.info("Чекбокс о контенте для взрослых установлен");

            await page.click(source.button);
            logger.info('Кнопка нажата');

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

    await handlePopup(page,POPUP_SELECTORS.indexPage); // Обработка всплывающего окна

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

async function saveChapters(page, chapters) {
    for (const chapter of chapters) {
        logger.info('Сохраняем главу... ' + chapter.title);
        await page.goto(chapter.link, { waitUntil: 'networkidle2' });

        // Обработка всплывающего окна (если оно есть)
        await handlePopup(page, POPUP_SELECTORS.readerPage);

        // Создание папки для сохранения изображений
        const chapterDir = path.join(DOWNLOADS_DIR, chapter.title.trim());
        if (!fs.existsSync(chapterDir)) {
            fs.mkdirSync(chapterDir,{recursive:true});
            logger.info(`Создана папка для главы: ${chapterDir}`);
        }

        // Получение URL изображения
        const imageUrl = await page.evaluate(() => {
            const imgElement = document.querySelector('.yj_kw.yj_kx');
            return imgElement ? imgElement.src : null;
        });

        if (!imageUrl) {
            logger.info(`Не удалось найти изображение для главы "${chapter.title}".`);
            continue; // Переходим к следующей главе, если изображения нет
        }

        logger.info(`Найдено изображение для главы "${chapter.title}": ${imageUrl}`);

        // Загрузка изображения
        try {
            // TODO: work with pagination because we save only the first image in chapter
            const viewSource = await page.goto(imageUrl, { waitUntil: 'networkidle2' });

            const imagePath = path.join(chapterDir, 'image.jpg'); // Сохраняем с именем image.png
            fs.writeFileSync(imagePath, await viewSource.buffer()); // Сохраняем изображение

            logger.info(`Изображение сохранено: ${imagePath}`);
        } catch (error) {
            logger.error(`Ошибка при загрузке изображения для главы "${chapter.title}": ${error.message}`);
            continue; // Переходим к следующей главе в случае ошибки
        }

        // Клик по изображению для перехода к следующей части
        // TODO: change this logic because we move backwards!
        await page.evaluate(() => {
            const imgElement = document.querySelector('.yj_kw.yj_kx');
            if (imgElement) {
                imgElement.click();
            }
        });

    }
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
    await saveChapters(page, chapters);

    // Логика для работы с главами (например, вывод в лог или другое)
    //logger.info('Готовые главы: ' + JSON.stringify(chapters));

    await browser.close();
}


main().catch(error => {
    logger.error('Ошибка: ' + error.message);
});
