def unescapeString(input: str) -> str:
    result = ""
    index = 0
    while index < len(input):
        print("Matching: ", input[index])
        if input[index] == "\\" and index + 1 < len(input):
            match input[index + 1]:
                case "n":
                    result += "\n"
                    index += 1

                case "t":
                    result += "\t"
                    index += 1

                case "r":
                    result += "\r"
                    index += 1

                case '"':
                    result += '"'
                    index += 1

                case "\\":
                    result += "\\"
                    index += 1

                # case 'u': # Handle Unicode escape sequence
                #     # Example for simplicity, real handling would be more complex
                #     if ((it + 4) < input.end()) {
                #         std::string hex_str(it + 1, it + 5);
                #         unsigned int unicode;
                #         std::stringstream ss(hex_str);
                #         ss >> std::hex >> unicode;
                #         result += static_cast<char>(unicode);
                #         it += 4; // Skip the hex digits
                #     }

                case _:
                    result += "\\"
                    result += input[index + 1]
                    index += 1
        else:
            result += input[index]
        index += 1
    return result
