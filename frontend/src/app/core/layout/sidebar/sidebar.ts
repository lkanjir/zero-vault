import { Component } from '@angular/core';
import { RouterLink } from "@angular/router";
import { Icon } from "../../icon/icon";

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {}
