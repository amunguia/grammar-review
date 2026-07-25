import urllib.request
import ssl
import re
import json
import html
import concurrent.futures
import time

ctx = ssl._create_unverified_context()

def clean_html(text):
    if not text:
        return ''
    cleaned = re.sub(r'<[^>]+>', '', text)
    return html.unescape(cleaned).strip()

def strip_furigana(text):
    if not text:
        return ''
    prev = ''
    curr = text
    while prev != curr:
        prev = curr
        curr = re.sub(r'（[ぁ-んァ-ヶーa-zA-Z0-9・〜～\s]+）', '', curr)
        curr = re.sub(r'\([ぁ-んァ-ヶーa-zA-Z0-9・〜～\s]+\)', '', curr)
    return curr

def fetch_grammar_detail(item_tuple):
    idx, item = item_tuple
    url = item['bunpro_url']
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    
    result = {
        'id': f'n3_{idx:03d}',
        'grammar_point': item['grammar_point'],
        'general_translation': item['general_translation'],
        'formation': '',
        'casual_structure': '',
        'polite_structure': '',
        'explanation': '',
        'lesson': item.get('lesson', ''),
        'lesson_topic': item.get('lesson_topic', ''),
        'example_sentences': [],
        'bunpro_url': url
    }
    
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=12) as resp:
            page_html = resp.read().decode('utf-8')
            m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page_html)
            if m:
                data = json.loads(m.group(1))
                props = data.get('props', {}).get('pageProps', {})
                reviewable = props.get('reviewable', {})
                included = props.get('included', {})
                
                casual_struct = clean_html(reviewable.get('casual_structure', ''))
                polite_struct = clean_html(reviewable.get('polite_structure', ''))
                formation = casual_struct if casual_struct else polite_struct
                nuance = clean_html(reviewable.get('nuance_translation', ''))
                
                study_questions = included.get('studyQuestions', [])
                examples = []
                for sq in study_questions:
                    content_raw = sq.get('content') or ''
                    answer_raw = sq.get('answer') or sq.get('kanji_answer') or ''
                    jp_sentence = content_raw.replace('____', answer_raw)
                    jp_clean = strip_furigana(clean_html(jp_sentence))
                    en_trans = clean_html(sq.get('translation') or '')
                    
                    if jp_clean and en_trans:
                        examples.append({
                            'japanese': jp_clean,
                            'english': en_trans
                        })
                
                result['formation'] = formation
                result['casual_structure'] = casual_struct
                result['polite_structure'] = polite_struct
                result['explanation'] = nuance
                result['example_sentences'] = examples
    except Exception as e:
        print(f"[{idx}] Error fetching {item['grammar_point']}: {e}")
        
    return idx, result

def main():
    # 1. Read deck HTML to get all 220 items with lesson mapping
    with open('/Users/alexmunguia/.gemini/antigravity/brain/9a26079a-8697-4329-8f96-89d6ef84f18b/.system_generated/steps/3/content.md', 'r', encoding='utf-8') as f:
        content = f.read()

    unit_blocks = re.split(r'class="w-100 deck-unit-outer-holder"', content)
    deck_items = []

    for u_idx, block in enumerate(unit_blocks[1:], 1):
        lesson_match = re.search(r'<div>(Lesson \d+)</div>\s*<div[^>]*>(.*?)</div>', block, re.DOTALL)
        lesson_title = lesson_match.group(1).strip() if lesson_match else f'Lesson {u_idx}'
        lesson_desc = html.unescape(lesson_match.group(2).strip()) if lesson_match else ''
        
        card_pattern = re.compile(
            r'href="(/grammar_points/[^"]+)".*?'
            r'deck-card-title">(.*?)</p>.*?'
            r'u-text_fg-secondary">(.*?)</span>',
            re.DOTALL
        )
        cards = card_pattern.findall(block)
        for href, title, trans in cards:
            deck_items.append({
                'lesson': lesson_title,
                'lesson_topic': lesson_desc,
                'grammar_point': html.unescape(title.strip()),
                'general_translation': html.unescape(trans.strip()),
                'bunpro_url': 'https://bunpro.jp' + href
            })

    print(f"Total grammar items to process: {len(deck_items)}")
    
    # 2. Fetch details concurrently (20 threads)
    results_map = {}
    items_tuples = [(i+1, item) for i, item in enumerate(deck_items)]
    
    start_time = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(fetch_grammar_detail, tup) for tup in items_tuples]
        for future in concurrent.futures.as_completed(futures):
            idx, res = future.result()
            results_map[idx] = res
            if len(results_map) % 20 == 0 or len(results_map) == len(deck_items):
                print(f"Processed {len(results_map)}/{len(deck_items)} items...")

    elapsed = time.time() - start_time
    print(f"Finished fetching all items in {elapsed:.2f}s!")

    # 3. Assemble final ordered list
    final_dataset = [results_map[i+1] for i in range(len(deck_items))]

    # 4. Save to json files
    with open('bunpro_n3_grammar.json', 'w', encoding='utf-8') as out:
        json.dump(final_dataset, out, ensure_ascii=False, indent=2)
        
    print("Successfully written complete dataset to bunpro_n3_grammar.json!")

if __name__ == '__main__':
    main()
