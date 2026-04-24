#!/usr/bin/env python3
"""Find the specific unclosed paren in redbubble handler."""

content = open('ipc/generation.js', 'r', encoding='utf-8').read()
lines = content.split('\n')

# Track paren depths per line for lines 310-496
redbubble_lines = lines[309:496]

depth_paren = 0
paren_history = []
in_single = False
in_double = False
in_template = 0
prev_char = ''

for i, line in enumerate(redbubble_lines, 310):
    line_opens = 0
    line_closes = 0
    
    for j, ch in enumerate(line):
        if in_single:
            if ch == "'" and prev_char != '\\':
                in_single = False
        elif in_double:
            if ch == '"' and prev_char != '\\':
                in_double = False
        elif in_template > 0:
            if ch == '`' and prev_char != '\\':
                in_template -= 1
        else:
            if ch == "'":
                in_single = True
            elif ch == '"':
                in_double = True
            elif ch == '`':
                in_template += 1
            elif ch == '(':
                depth_paren += 1
                line_opens += 1
            elif ch == ')':
                depth_paren -= 1
                line_closes += 1
        
        prev_char = ch
    
    if in_single or in_double:
        in_single = False
        in_double = False
    prev_char = ''
    
    if line_opens != line_closes:
        print(f'Line {i} (opens={line_opens}, closes={line_closes}, depth={depth_paren}): {line!r}')
    
print(f'\nFinal paren depth: {depth_paren}')
