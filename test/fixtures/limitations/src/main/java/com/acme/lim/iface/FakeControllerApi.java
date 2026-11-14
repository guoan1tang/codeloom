package com.acme.lim.iface;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public interface FakeControllerApi {
    @PostMapping("/fake-endpoint")
    String fake();
}
