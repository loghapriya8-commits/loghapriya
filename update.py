import os, glob, re

for file in glob.glob('*.html'):
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace language options
    content = re.sub(
        r'<option value="en">EN</option>[\s\S]*?<option value="ml">ML</option>',
        '<option value="en">EN</option><option value="hi">HI</option>',
        content
    )
    
    # Highlight Interview link
    content = re.sub(
        r'<a href="interview\.html">🎯 Interview<\/a[\s\S]*?>', 
        '<a href="interview.html" class="nav-highlight">🎯 Interview</a>',
        content
    )
    
    # Address index.html text
    if file == 'index.html':
        content = re.sub(
            r'Multi-language Career Platform \(English.*?Malayalam\)\.', 
            'Multi-language Career Platform (English, Hindi).',
            content
        )

    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

print("Update finished.")
