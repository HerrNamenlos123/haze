#!/bin/bash

# antlr4 -Dlanguage=Python3 Toy.g4 -visitor

set -e
LOCATION=antlr-4.13.2-complete.jar
java -jar $LOCATION -Dlanguage=Python3 Haze.g4 -visitor -o grammar
