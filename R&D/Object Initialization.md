# Object Initialization

Haze does not use Zero Initialization (ZII) like Casey and Ryan.

Casey and Ryan think that everything should always be zero initialized and architected in a way that **ZERO IS NOT AN INVALID STATE**.
The don't say that is must mean something. So the system should be made so that zero is always a valid state (e.g. pointers are null = to be expected).
It does not mean that the object is initialized per se. 

The programmer still has to initialize the object with whatever values they want, that may not be zero.
This creates a separation into two layers, phase one of *Objects that are kind of initialized but not actually initialized (only zero-initialized)*
and phase two of *Objects that are actually initialized* with the values the programmer wants.

This opens room for even more mistakes, because you may forget to initialize the objects, and then the values in there
are zero, which are values that the compiler gave you and not values that the programmer intentionally put there.

## Solution

For this reason, there is no automatic initialization at all in Haze. Instead, all objects are always required to be
initialized explicitly. There is no way to ever be able to create a variable, call a function with parameters,
or creating a static array with fixed size, that contain values that are not initialized explicitly.
This forces the programmer to always, when a new object is born in a memory location, give it a value.

To make this simpler, it is possible to give members of structs default values in the struct declaration, and the 
default values are used when constructing a struct when that member is not explicitly specified.

This means that there is no separation into phases, there is no phase where a value can ever be uninitialized, undefined
or zero-initialized with values the programmer doesn't want, and instead only a single phase with objects that are 
always valid in the way the programmer wants them to be. This way, every value that is ever in a struct, has explicitly
been put there by the programmer in some way.

If a programmer still wants zero initialization by default, they can just specify 0 as the default value for all
struct members, and when creating a new struct, not a single member needs to be named and everything will be zero.

But now all of that is a conscious decision.