#!/usr/bin/python

import csv
import math
import sys

csv_file = sys.argv[1]
with open(csv_file, 'r') as f:
    reader = csv.reader(f)
    data = [row for row in reader]

# flip data to be column-wise
cols = [[] for i in data[0]]
for row in data:
    for i, col in enumerate(row):
        cols[i].append(col)

# remove empty columns:
for i in range(len(cols) - 1, 1, -1):
    data = map(float, cols[i][1:])
    if sum(data) == 0:
        cols.pop(i)

# map to range [0, 100]
#min_out = 0
#max_out =  100
#for col in cols[2:]:
#    data = map(float, col[1:])
#    min_in = min(data)
#    max_in = max(data)
#    if max_in == min_in:
#        continue
#    slope = (max_out - min_out) / (max_in - min_in)
#    for i in range(len(col)):
#        if i > 0:
#            col[i] = min_out + slope * (float(col[i]) - min_in)

# calc the coefficient of variations
std_devs = [10000, 9999]
for col in cols[2:]:
    data = map(float, col[1:])
    avg = sum(data) / len(data)
    var = sum(pow(d - avg, 2) for d in data) / len(data)
    std_dev = math.sqrt(var)
    std_devs.append(std_dev)

tmp = zip(std_devs, cols)
tmp.sort(reverse=True)

# back into rows
rows = [[] for i in cols[0]]
for _,col in tmp:
    for i, row in enumerate(col):
        rows[i].append(row)

with open('processed-' + csv_file, 'w') as f:
    writer = csv.writer(f)
    writer.writerows(rows)
