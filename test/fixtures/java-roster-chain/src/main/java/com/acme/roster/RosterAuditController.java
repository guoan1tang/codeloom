package com.acme.roster;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/roster-audit")
public class RosterAuditController {
    @Autowired
    private RosterAuditService rosterAuditService;

    @PostMapping("/page")
    public Object page(@RequestBody Object request) {
        return rosterAuditService.getRosterAuditPage(1L);
    }
}