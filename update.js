const fs = require('fs');

const glob = fs.readdirSync('.').filter(f => f.endsWith('.html'));

glob.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace language options
    content = content.replace(
        /<option value="en">EN<\/option>[\s\S]*?<option value="ml">ML<\/option>/g, 
        '<option value="en">EN</option><option value="hi">HI</option>'
    );
    
    // Highlight Interview link
    // Account for possible newlines and extra spaces around the link
    content = content.replace(
        /<a href="interview\.html">🎯 Interview<\/a[\s\S]*?>/g, 
        '<a href="interview.html" class="nav-highlight">🎯 Interview</a>'
    );
    
    // Address index.html text
    if (file === 'index.html') {
        content = content.replace(
            /Multi-language Career Platform \(English.*?Malayalam\)\./g, 
            'Multi-language Career Platform (English, Hindi).'
        );
    }
    
    fs.writeFileSync(file, content);
});

console.log('Update finished.');
