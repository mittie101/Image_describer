#!/usr/bin/env python3
"""Find paren/brace mismatch in redbubble handler (lines 310-496)."""

content = open('ipc/generation.js', 'r', encoding='utf-8').read()
lines = content.split('\n')

# Trace depth through lines 310-496 (0-indexed: 309-495)
redbubble_lines = lines[309:496]

depth_paren = 0
depth_brace = 0
depth_bracket = 0
in_single = False
in_double = False
in_template = 0  # template depth
prev_char = ''

for i, line in enumerate(redbubble_lines, 310):
    for j, ch in enumerate(line):
        # Handle string state
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
            elif ch == ')':
                depth_paren -= 1
                if depth_paren < 0:
                    print(f'PAREN GOES NEGATIVE at line {i}, col {j}: {line!r}')
            elif ch == '{':
                depth_brace += 1
            elif ch == '}':
                depth_brace -= 1
                if depth_brace < 0:
                    print(f'BRACE GOES NEGATIVE at line {i}, col {j}: {line!r}')
            elif ch == '[':
                depth_bracket += 1
            elif ch == ']':
                depth_bracket -= 1
        
        prev_char = ch
    
    # Reset string state at end of line (single/double quoted strings can't span lines in JS)
    if in_single or in_double:
        in_single = False
        in_double = False
    prev_char = ''

print(f'\nFinal depths after line 496:')
print(f'  paren: {depth_paren}')
print(f'  brace: {depth_brace}')
print(f'  bracket: {depth_bracket}')
print(f'  in_template: {in_template}')
