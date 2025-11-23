const cheerio = require('cheerio');

/**
 * Parse MapsetVerifier HTML output into structured JS object
 * @param {string} html - HTML string from MapsetVerifier
 * @returns {object} Parsed result with difficulties and their checks
 */
function parseMapsetVerifierHTML(html) {
    const $ = cheerio.load(html);
    const result = {
        beatmapTitle: $('.beatmap-title').text().trim(),
        beatmapAuthor: $('.beatmap-author-field a').text().trim(),
        difficulties: []
    };

    // Parse each difficulty's cards
    $('.card').each((i, cardElem) => {
        const $card = $(cardElem);
        const difficulty = $card.attr('data-difficulty');
        const $cardBox = $card.find('.card-box').first();
        const category = $cardBox.find('.card-title').text().trim();
        
        // Determine severity from the icon
        let severity = 'pass';
        if ($cardBox.find('.large-icon.cross-icon').length > 0) {
            severity = 'major';
        } else if ($cardBox.find('.large-icon.exclamation-icon').length > 0) {
            severity = 'issue';
        } else if ($cardBox.find('.large-icon.minor-icon').length > 0) {
            severity = 'minor';
        }

        // Find or create difficulty entry
        let diffEntry = result.difficulties.find(d => d.difficulty === difficulty);
        if (!diffEntry) {
            diffEntry = {
                difficulty: difficulty,
                categories: []
            };
            result.difficulties.push(diffEntry);
        }

        // Parse card details
        const checks = [];
        const $cardDetails = $card.find('.card-details').first();
        
        // Process each card-detail that is a direct child (not nested in card-detail-instances)
        $cardDetails.children('.card-detail').each((j, detailElem) => {
            const $detail = $(detailElem);
            const checkName = $detail.attr('data-check');
            
            // Determine severity from the detail icon
            let detailSeverity = 'pass';
            const $detailIcon = $detail.find('.card-detail-icon').first();
            if ($detailIcon.hasClass('cross-icon')) {
                detailSeverity = 'major';
            } else if ($detailIcon.hasClass('exclamation-icon')) {
                detailSeverity = 'issue';
            } else if ($detailIcon.hasClass('minor-icon')) {
                detailSeverity = 'minor';
            }

            // Get the detail text and convert <a> elements to markdown links
            const $detailText = $detail.find('.card-detail-text').first();
            let text = '';
            
            if ($detailText.length > 0) {
                text = parseTextWithLinks($, $detailText);
            } else {
                // For nested divs without card-detail-text, get the text from the div after icon
                const $contentDiv = $detail.children('div').not('.card-detail-icon, .doc-shortcut, .vertical-arrow').first();
                if ($contentDiv.length > 0) {
                    text = parseTextWithLinks($, $contentDiv);
                }
            }

            const check = {
                name: checkName || text,
                severity: detailSeverity,
                text: text,
                instances: []
            };

            // Check for instances (nested card-detail-instances)
            const $instances = $detail.next('.card-detail-instances');
            if ($instances.length > 0) {
                $instances.find('.card-detail').each((k, instanceElem) => {
                    const $instance = $(instanceElem);
                    const $instanceIcon = $instance.find('.card-detail-icon').first();
                    
                    let instanceSeverity = 'pass';
                    if ($instanceIcon.hasClass('cross-icon')) {
                        instanceSeverity = 'major';
                    } else if ($instanceIcon.hasClass('exclamation-icon')) {
                        instanceSeverity = 'issue';
                    } else if ($instanceIcon.hasClass('minor-icon')) {
                        instanceSeverity = 'minor';
                    }

                    // Get text from the div after the icon
                    const $instanceContent = $instance.children('div').not('.card-detail-icon').first();
                    const instanceText = parseTextWithLinks($, $instanceContent);

                    check.instances.push({
                        severity: instanceSeverity,
                        text: instanceText
                    });
                });
            }

            checks.push(check);
        });

        diffEntry.categories.push({
            category: category,
            severity: severity,
            checks: checks
        });
    });

    return result;
}

/**
 * Parse text content and convert <a> elements to markdown links
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {Cheerio} $element - Element to parse
 * @returns {string} Parsed text with markdown links
 */
function parseTextWithLinks($, $element) {
    let text = '';
    
    // Clone to avoid modifying original
    const $clone = $element.clone();
    
    // Process each child node
    $clone.contents().each((i, node) => {
        if (node.type === 'text') {
            text += $(node).text();
        } else if (node.type === 'tag') {
            const $node = $(node);
            if (node.name === 'a') {
                const href = $node.attr('href');
                const linkText = $node.text().trim();
                
                // Check if it's an osu://edit/ link
                if (href && href.startsWith('osu://edit/')) {
                    const timestamp = href.replace('osu://edit/', '');
                    const axerUrl = `https://axer-url.vercel.app/api/edit?time=${encodeURIComponent(timestamp)}`;
                    text += `[${linkText}](${axerUrl})`;
                } else if (href) {
                    text += `[${linkText}](${href})`;
                } else {
                    text += linkText;
                }
            } else {
                // Recursively process nested elements
                text += parseTextWithLinks($, $node);
            }
        }
    });
    
    return text.trim();
}

module.exports = {
    parseMapsetVerifierHTML
};
