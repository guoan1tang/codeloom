package com.acme.lim.reflect;

public class Reflector {
    public Object make() throws Exception {
        return Class.forName("com.acme.Hidden").getDeclaredConstructor().newInstance();
    }
}
