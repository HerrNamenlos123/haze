graph TD
  E1["Module Scope"]
  E2["Unit Scope"] --> E1
  E9["Unit Scope"] --> E1
  E3["/home/fzachs/Projects/haze/stdlib/internal/internal.hz"] --> E2
  E4["/home/fzachs/Projects/haze/stdlib/internal/Arena.hz"] --> E2
  E5["/home/fzachs/Projects/haze/stdlib/internal/Result.hz"] --> E2
  E6["/home/fzachs/Projects/haze/stdlib/internal/Vec2.hz"] --> E2
  E7["/home/fzachs/Projects/haze/stdlib/internal/Math.hz"] --> E2
  E8["/home/fzachs/Projects/haze/stdlib/internal/Color.hz"] --> E2
  E10["/home/fzachs/Projects/haze/stdlib/glfw/src/GLFW.hz"] --> E9
  E140["/home/fzachs/Projects/haze/stdlib/glfw/src/main.hz"] --> E9
  E99["Namespace glfw"] --> E10
  E133["Namespace Outer"] --> E10
  E134["Namespace Inner"] --> E133
  E12["Function Symbol"] --> E10
  E12 --> E11
  E15["Function Symbol"] --> E10
  E15 --> E14
  E18["Function Symbol"] --> E10
  E18 --> E17
  E34["Function Symbol"] --> E10
  E34 --> E33
  E40["Function Symbol"] --> E10
  E40 --> E39
  E46["Function Symbol"] --> E10
  E46 --> E45
  E51["Function Symbol"] --> E10
  E51 --> E50
  E57["Function Symbol"] --> E10
  E57 --> E56
  E60["Function Symbol"] --> E10
  E60 --> E59
  E67["Function Symbol"] --> E10
  E67 --> E66
  E74["Function Symbol"] --> E10
  E74 --> E73
  E81["Function Symbol"] --> E10
  E81 --> E80
  E101["Function Symbol"] --> E99
  E101 --> E100
  E106["Function Symbol"] --> E99
  E106 --> E105
  E111["Function Symbol"] --> E99
  E111 --> E110
  E122["Function Symbol"] --> E99
  E122 --> E121
  E129["Function Symbol"] --> E99
  E129 --> E128
  E136["Function Symbol"] --> E134
  E136 --> E135
  E11["Function 'glfwInit' Overload"] --> E10
  E14["Function 'glfwTerminate' Overload"] --> E10
  E17["Function 'glfwCreateWindow' Overload"] --> E10
  E33["Function 'glfwWindowShouldClose' Overload"] --> E10
  E39["Function 'glfwSwapBuffers' Overload"] --> E10
  E45["Function 'glfwSwapInterval' Overload"] --> E10
  E50["Function 'glfwMakeContextCurrent' Overload"] --> E10
  E56["Function 'glfwPollEvents' Overload"] --> E10
  E59["Function 'glfwInitHint' Overload"] --> E10
  E66["Function 'glfwWindowHint' Overload"] --> E10
  E73["Function 'strcmp' Overload"] --> E10
  E80["Function 'getenv' Overload"] --> E10
  E100["Function 'init' Overload"] --> E99
  E105["Function 'terminate' Overload"] --> E99
  E110["Function 'createWindow' Overload"] --> E99
  E121["Function 'swapInterval' Overload"] --> E99
  E128["Function 'pollEvents' Overload"] --> E99
  E135["Function 'foo' Overload"] --> E134
