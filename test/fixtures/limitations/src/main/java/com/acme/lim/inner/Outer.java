package com.acme.lim.inner;

public class Outer {
    public static class Inner {
        public void hidden() {
        }
    }

    public void visible() {
        new Inner().hidden();
    }
}
