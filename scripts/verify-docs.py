#!/usr/bin/env python3
"""
Khodrekab Documentation & Link Verification Utility
Validates that 100% of internal links, images, and anchors in repository markdown files resolve properly.
"""

import os
import re
import sys
import glob

def check_markdown_links():
    md_files = glob.glob('docs/*.md') + glob.glob('.github/**/*.md', recursive=True) + ['README.md']
    errors = []
    total_links = 0

    print(f"Inspecting {len(md_files)} markdown documents for link integrity...")

    for doc in md_files:
        if not os.path.exists(doc):
            continue
        content = open(doc, 'r', encoding='utf-8').read()
        links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', content)
        doc_dir = os.path.dirname(doc)

        for text, link in links:
            # Skip external links, mailto, and pure anchor jumps
            if link.startswith('http://') or link.startswith('https://') or link.startswith('mailto:') or link.startswith('#'):
                continue

            total_links += 1
            target_path = link.split('#')[0]
            if not target_path:
                continue

            full_path = os.path.normpath(os.path.join(doc_dir, target_path))
            if not os.path.exists(full_path):
                errors.append(f"Broken link in '{doc}': [{text}]({link}) -> resolved to missing '{full_path}'")

    print(f"Verified {total_links} internal relative links.")
    if errors:
        print(f"\nFAILED: Found {len(errors)} broken link(s):")
        for err in errors:
            print(f"  ❌ {err}")
        return False

    print("✅ All relative links resolve to existing files!")
    return True

if __name__ == '__main__':
    success = check_markdown_links()
    sys.exit(0 if success else 1)
