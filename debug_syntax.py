#!/usr/bin/env python3
"""Find syntax issues in generation.js."""

content = open('ipc/generation.js', 'r', encoding='utf-8').read()
lines = content.split('\n')

# Simple depth tracking (ignores strings/comments for now)
depth_paren = 0
depth_brace = 0

for i, line in enumerate(lines[:500], 1):
    for ch in line:
        if ch == '(':
            depth_paren += 1
        elif ch == ')':
            depth_paren -= 1
        elif ch == '{':
            depth_brace += 1
        elif ch == '}':
            depth_brace -= 1
    if i in [38, 50, 100, 150, 200, 250, 308, 350, 400, 450, 496, 497]:
        print(f'Line {i}: paren={depth_paren} brace={depth_brace}')
    if depth_paren < -2 or depth_brace < -2:
        print(f'VERY NEGATIVE at line {i}: paren={depth_paren} brace={depth_brace}')
        print(f'  Line: {line!r}')
        break

print(f"\nFinal at 496: paren={depth_paren} brace={depth_brace}")

# Also look at line 490 content
print(f"\nLine 490: {lines[489]!r}")
print(f"Line 491: {lines[490]!r}")
print(f"Line 492: {lines[491]!r}")
